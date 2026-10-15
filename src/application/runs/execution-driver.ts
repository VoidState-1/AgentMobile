import type { AgentEnginePort, EngineInput, EngineSession } from '@/core/agent/engine';
import { authorizedTools, toolAllowed, type AgentDefinition } from '@/core/agent/definitions';
import { AppError, publicError } from '@/core/errors';
import type { RunStopController } from '@/core/runs/termination';
import type { RunRecorder } from './recorder';
export interface ExecutionAdmission {
    acquire(signal?: AbortSignal): Promise<{
        release(): void;
    }>;
    reserve(resource: 'requests' | 'tools'): Promise<void>;
    checkStop(): void;
    fail(error: unknown): void;
    timeout(): void;
    remainingMs(): number;
}
/** Shared dispatch/lifecycle mechanism. Workspace and delegation remain outside. */
export class ExecutionDriver {
    readonly session: EngineSession;
    private permit?: {
        release(): void;
    };
    private timer: ReturnType<typeof setTimeout>;
    private readonly cancel: () => void;
    constructor(port: AgentEnginePort, input: EngineInput, role: AgentDefinition, private readonly recorder: RunRecorder, private readonly stop: RunStopController, private readonly admission: ExecutionAdmission) {
        const tools = authorizedTools(role, input.tools);
        this.session = port.create({ ...input, tools }, recorder.receive, {
            beforeRequest: async (signal) => {
                admission.checkStop();
                this.permit = await admission.acquire(signal ?? stop.signal);
                try {
                    admission.checkStop();
                    await admission.reserve('requests');
                }
                catch (error) {
                    admission.fail(error);
                    this.release();
                    throw error;
                }
            },
            afterRequest: () => this.release(),
            beforeTool: async (invocation) => {
                this.release();
                if (stop.signal.aborted)
                    return { block: true, reason: '运行已停止。', terminate: true };
                await recorder.persist();
                const tool = tools.find(tool => tool.name === invocation.tool);
                if (!tool || !toolAllowed(role, tool)) {
                    const error = new AppError('VALIDATION', '工具未在冻结角色授权中。');
                    admission.fail(error);
                    return { block: true, reason: error.message, terminate: true };
                }
                try {
                    admission.checkStop();
                    await admission.reserve('tools');
                    return;
                }
                catch (error) {
                    admission.fail(error);
                    return { block: true, reason: publicError(error).message, terminate: true };
                }
            },
        });
        this.cancel = () => this.session.cancel();
        stop.signal.addEventListener('abort', this.cancel, { once: true });
        if (stop.signal.aborted)
            this.cancel();
        this.timer = setTimeout(() => { admission.timeout(); this.cancel(); }, admission.remainingMs());
    }
    get round(): number { return this.session.round; }
    async execute() {
        try {
            const result = await this.session.execute();
            this.admission.checkStop();
            return result;
        }
        finally {
            this.release();
        }
    }
    async continue(prompt: string) {
        this.admission.checkStop();
        if (!this.session.continue)
            throw new AppError('VALIDATION', '引擎不支持子任务汇总。');
        try {
            const result = await this.session.continue(prompt);
            this.admission.checkStop();
            return result;
        }
        finally {
            this.release();
        }
    }
    private release() { this.permit?.release(); this.permit = undefined; }
    beginFinalization() {
        this.recorder.beginFinalization();
        clearTimeout(this.timer);
        this.stop.signal.removeEventListener('abort', this.cancel);
        this.release();
    }
}
