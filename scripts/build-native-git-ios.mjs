import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'darwin')
  throw new Error('iOS native Git requires macOS, Xcode and CMake.');
await execute(process.execPath, [path.join(root, 'scripts/prepare-native-git.mjs')]);
const moduleRoot = path.join(root, 'modules/agent-mobile-git');
const artifacts = [];
for (const [sdk, architectures] of [
  ['iphoneos', 'arm64'],
  ['iphonesimulator', 'arm64;x86_64'],
]) {
  const build = path.join(root, 'work/native-git/ios', sdk);
  const sysroot = (await execute('xcrun', ['--sdk', sdk, '--show-sdk-path'])).stdout.trim();
  await execute(
    'cmake',
    [
      '-S',
      moduleRoot,
      '-B',
      build,
      '-G',
      'Xcode',
      '-DCMAKE_SYSTEM_NAME=iOS',
      `-DCMAKE_OSX_SYSROOT=${sysroot}`,
      `-DCMAKE_OSX_ARCHITECTURES=${architectures}`,
      '-DCMAKE_OSX_DEPLOYMENT_TARGET=16.4',
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  await execute(
    'cmake',
    [
      '--build',
      build,
      '--config',
      'Release',
      '--target',
      'agent_mobile_git_core',
      '--',
      'CODE_SIGNING_ALLOWED=NO',
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const archives = [];
  for await (const file of fs.glob('**/*.a', { cwd: build })) {
    if (['libagent_mobile_git_core.a', 'libgit2.a'].includes(path.basename(file)))
      archives.push(path.join(build, file));
  }
  if (archives.length !== 2) throw new Error(`Expected core and libgit2 archives for ${sdk}`);
  const library = path.join(build, 'libAgentMobileGitCore.a');
  await execute('xcrun', ['libtool', '-static', '-o', library, ...archives]);
  artifacts.push('-library', library, '-headers', path.join(moduleRoot, 'cpp'));
}
const framework = path.join(moduleRoot, 'ios/Frameworks/AgentMobileGitCore.xcframework');
if (path.dirname(framework) !== path.join(moduleRoot, 'ios/Frameworks'))
  throw new Error('Invalid framework output');
await fs.rm(framework, { recursive: true, force: true });
await execute('xcodebuild', ['-create-xcframework', ...artifacts, '-output', framework]);
process.stdout.write('Built native Git XCFramework for iOS device and simulator.\n');
