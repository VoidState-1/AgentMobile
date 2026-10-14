export const fileName = (path: string) => path.split('/').pop() ?? path;
export const sizeLabel = (size: number) => size < 1024 ? size + ' B' : size < 1024 * 1024 ? Math.ceil(size / 1024) + ' KB' : (size / 1024 / 1024).toFixed(1) + ' MB';
export const dateLabel = (value: string | number) => new Date(value).toLocaleString('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
export const toolLabels: Record<string, string> = {
  list_files: '浏览项目文件', read_text: '读取文字资料', write_text: '保存文字内容', search_text: '搜索项目资料',
  inspect_image: '读取图片', move_file: '移动文件', delete_file: '删除文件',
  load_skill: '加载技能', read_skill_resource: '读取技能资源',
  git_status: '查看 Git 状态', git_diff: '查看 Git 差异', git_stage: '暂存文件', git_unstage: '取消暂存', git_commit: '提交更改',
};
