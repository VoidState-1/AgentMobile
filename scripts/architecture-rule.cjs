const path = require('node:path');

// Normalize aliases and relative paths; string patterns miss dynamic dependencies.
module.exports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      boundary: '{{layer}} 层不能引用 {{dependency}}；请通过正式领域端口或应用接口访问。',
      dynamic: '分层源文件的动态模块路径必须是可静态检查的字符串。',
    },
  },
  create(context) {
    const sourceRoot = path.resolve(context.cwd, 'src');
    const layerOf = file => path.relative(sourceRoot, file).replaceAll('\\', '/').split('/')[0];
    const layer = layerOf(context.filename);
    const sharedUi = /[\\/]shared[\\/](ui[\\/]|theme)/.test(context.filename);
    if (!['core', 'application', 'features'].includes(layer) && !sharedUi) return {};
    const check = node => {
      if (!node) return;
      if (typeof node.value !== 'string') {
        context.report({ node, messageId: 'dynamic' });
        return;
      }
      const dependency = node.value;
      const target = dependency.startsWith('@/')
        ? path.join(sourceRoot, dependency.slice(2))
        : dependency.startsWith('.')
          ? path.resolve(path.dirname(context.filename), dependency)
          : undefined;
      const targetLayer = target && layerOf(target);
      let forbidden = false;
      if (layer === 'core' || layer === 'application') {
        const allowed = layer === 'core' ? ['core'] : ['core', 'application'];
        // TypeBox is the platform-independent tool schema contract.
        forbidden = target ? !allowed.includes(targetLayer) : !['typebox'].includes(dependency);
      } else if (layer === 'features') forbidden = targetLayer === 'adapters';
      else if (sharedUi) forbidden = ['features', 'adapters'].includes(targetLayer);
      if (forbidden) context.report({ node, messageId: 'boundary', data: { layer, dependency } });
    };
    return {
      ImportDeclaration: node => check(node.source),
      ExportNamedDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ImportExpression: node => check(node.source),
      TSImportType: node => check(node.source),
      TSExternalModuleReference: node => check(node.expression),
      CallExpression: node => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require')
          check(node.arguments[0]);
      },
    };
  },
};
