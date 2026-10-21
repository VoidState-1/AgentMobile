#include "repository.h"
#include <git2.h>
#include <git2/sys/repository.h>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#include <thread>
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <cerrno>
#include <stdio.h>
#ifdef __ANDROID__
#include <sys/syscall.h>
#endif

namespace {
using Json = nlohmann::json;
namespace fs = std::filesystem;
template <typename T, void (*Free)(T *)> using Ptr = std::unique_ptr<T, decltype(Free)>;
using Repo = Ptr<git_repository, git_repository_free>;
using Index = Ptr<git_index, git_index_free>;
using Tree = Ptr<git_tree, git_tree_free>;
using Commit = Ptr<git_commit, git_commit_free>;
using Blob = Ptr<git_blob, git_blob_free>;
using Object = Ptr<git_object, git_object_free>;
using Ref = Ptr<git_reference, git_reference_free>;
using Remote = Ptr<git_remote, git_remote_free>;
using Config = Ptr<git_config, git_config_free>;
using Sig = Ptr<git_signature, git_signature_free>;
struct Failure : std::runtime_error {
  std::string code;
  bool uncertain;
  Failure(const std::string &kind, const std::string &message, bool unknown = false) : std::runtime_error(message), code(kind), uncertain(unknown) {}
};
void require(bool condition, const std::string &message) {
  if (!condition) throw Failure("VALIDATION", message);
}
void check(int value) {
  if (value >= 0) return;
  const auto *error = git_error_last();
  throw Failure(value == GIT_EUSER ? "CANCELLED" : value == GIT_ECONFLICT || value == GIT_EMODIFIED || value == GIT_EUNMERGED ? "CONFLICT" : "STORAGE",
    error ? error->message : "Git operation failed");
}
std::string id(const git_oid *oid) {
  char result[GIT_OID_HEXSZ + 1];
  git_oid_tostr(result, sizeof(result), oid);
  return result;
}
git_oid parseId(const std::string &value) {
  require(value.size() == GIT_OID_HEXSZ, "Invalid object ID");
  git_oid result;
  check(git_oid_fromstr(&result, value.c_str()));
  return result;
}
std::string safePath(const std::string &path) {
  require(!path.empty() && path.front() != '/' && path.back() != '/' && path.find("//") == std::string::npos && path.find('\\') == std::string::npos && path.find(':') == std::string::npos && path.find('\0') == std::string::npos,
          "Use a repository-relative path");
  Json(path).dump(); // Git permits arbitrary bytes; the application's path contract requires UTF-8.
  auto codepoint = [&](size_t position) {
    unsigned char first = path[position]; if (first < 128) return uint32_t(first);
    unsigned count = first < 224 ? 2 : first < 240 ? 3 : 4;
    uint32_t value = first & (127 >> count);
    for (unsigned i = 1; i < count; ++i) value = (value << 6) | (static_cast<unsigned char>(path[position + i]) & 63);
    return value;
  };
  auto space = [](uint32_t value) { return value == 9 || value == 10 || value == 11 || value == 12 || value == 13 || value == 32 || value == 160 || value == 5760 || (value >= 8192 && value <= 8202) || value == 8232 || value == 8233 || value == 8239 || value == 8287 || value == 12288 || value == 65279; };
  size_t last = path.size() - 1; while (last && (static_cast<unsigned char>(path[last]) & 192) == 128) --last;
  require(!space(codepoint(0)) && !space(codepoint(last)), "路径不能包含首尾空白");
  for (unsigned char value : path) require(value >= 32 && value != 127, "路径不能包含控制字符");
  for (const auto &part : fs::path(path)) {
    std::string value = part.string();
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) { return std::tolower(c); });
    require(!value.empty() && value != "." && value != ".." && value != ".git", "Protected repository path");
    require(value.back() != '.' && value.back() != ' ', "路径组件不能以点或空格结尾");
    const auto base = value.substr(0, value.find('.'));
    require(base != "con" && base != "prn" && base != "aux" && base != "nul" && !(base.size() == 4 && (base.substr(0, 3) == "com" || base.substr(0, 3) == "lpt") && base[3] >= '1' && base[3] <= '9'), "路径组件为保留设备名");
  }
  return path;
}
std::string base64(const void *pointer, size_t length) {
  const auto *bytes = static_cast<const unsigned char *>(pointer);
  static const char *alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve((length + 2) / 3 * 4);
  for (size_t i = 0; i < length; i += 3) {
    unsigned value = unsigned(bytes[i]) << 16;
    if (i + 1 < length) value |= unsigned(bytes[i + 1]) << 8;
    if (i + 2 < length) value |= bytes[i + 2];
    out += alphabet[(value >> 18) & 63]; out += alphabet[(value >> 12) & 63];
    out += i + 1 < length ? alphabet[(value >> 6) & 63] : '=';
    out += i + 2 < length ? alphabet[value & 63] : '=';
  }
  return out;
}
std::string decode(const std::string &value) {
  static const std::string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  unsigned accumulator = 0, bits = 0;
  require(value.size() % 4 == 0, "Invalid base64 bytes");
  for (char c : value) {
    if (c == '=') break;
    auto found = alphabet.find(c);
    require(found != std::string::npos, "Invalid base64 bytes");
    accumulator = (accumulator << 6) | unsigned(found); bits += 6;
    if (bits >= 8) { bits -= 8; out += char((accumulator >> bits) & 255); }
  }
  return out;
}
void ioError(const char *message) {
  if (errno == ENOENT) throw Failure("ENOENT", "文件不存在");
  if (errno == EEXIST) throw Failure("CONFLICT", "目标已存在");
  throw Failure("STORAGE", message);
}
void requireActive(const am_git_callbacks &callbacks) {
  if (callbacks.cancelled && callbacks.cancelled(callbacks.context)) throw Failure("CANCELLED", "Git 操作已取消");
}
/** Shared by every bridge instance, including workers surviving a React context reload. */
class RepositoryLease {
  std::shared_ptr<std::timed_mutex> mutex;
  std::unique_lock<std::timed_mutex> local;
  int descriptor = -1;
public:
  RepositoryLease(const fs::path &root, const am_git_callbacks &callbacks) {
    static std::mutex registryLock;
    static std::map<std::string, std::weak_ptr<std::timed_mutex>> registry;
    {
      std::lock_guard<std::mutex> guard(registryLock);
      auto &entry = registry[root.lexically_normal().string()];
      mutex = entry.lock();
      if (!mutex) { mutex = std::make_shared<std::timed_mutex>(); entry = mutex; }
    }
    local = std::unique_lock<std::timed_mutex>(*mutex, std::defer_lock);
    while (!local.try_lock_for(std::chrono::milliseconds(25))) requireActive(callbacks);
    requireActive(callbacks);
    // The bridge owns this private project directory. flock also covers another app process.
    fs::create_directories(root.parent_path());
    descriptor = ::open((root.parent_path() / "native-git.lock").c_str(), O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (descriptor < 0) ioError("无法锁定 Git 工作区");
    try {
      struct stat info;
      if (::fstat(descriptor, &info) < 0) ioError("无法检查工作区锁");
      require(S_ISREG(info.st_mode), "工作区锁不是普通文件");
      while (::flock(descriptor, LOCK_EX | LOCK_NB) < 0) {
        if (errno != EINTR && errno != EWOULDBLOCK && errno != EAGAIN) ioError("无法锁定 Git 工作区");
        requireActive(callbacks);
        std::this_thread::sleep_for(std::chrono::milliseconds(25));
      }
      requireActive(callbacks);
    } catch (...) { ::close(descriptor); descriptor = -1; throw; }
  }
  ~RepositoryLease() { if (descriptor >= 0) { ::flock(descriptor, LOCK_UN); ::close(descriptor); } }
};
void recoverLocks(const fs::path &root) {
  const auto directory = root / ".git";
  struct stat info;
  if (::lstat(directory.c_str(), &info) < 0) ioError("无法检查 Git 目录");
  require(S_ISDIR(info.st_mode), "Git 目录必须位于项目内部");
  std::vector<fs::path> locks;
  auto inspect = [&](const fs::path &path) {
    struct stat value;
    if (::lstat(path.c_str(), &value) < 0) { if (errno == ENOENT) return; ioError("无法检查 Git 锁"); }
    require(S_ISREG(value.st_mode), "Git 锁不是普通文件，请保留数据进行检查");
    locks.push_back(path);
  };
  for (const auto *name : {"index", "HEAD", "config", "packed-refs", "shallow", "ORIG_HEAD", "FETCH_HEAD", "MERGE_HEAD", "MERGE_MSG", "MERGE_MODE", "REBASE_HEAD"})
    inspect(directory / (std::string(name) + ".lock"));
  std::function<void(const fs::path &)> walk = [&](const fs::path &path) {
    struct stat value;
    if (::lstat(path.c_str(), &value) < 0) { if (errno == ENOENT) return; ioError("无法检查 Git 引用目录"); }
    require(S_ISDIR(value.st_mode), "Git 引用目录不能是链接或特殊文件");
    for (const auto &entry : fs::directory_iterator(path)) {
      if (::lstat(entry.path().c_str(), &value) < 0) ioError("无法检查 Git 引用");
      if (S_ISDIR(value.st_mode)) walk(entry.path());
      else if (entry.path().extension() == ".lock") inspect(entry.path());
      else require(S_ISREG(value.st_mode), "Git 引用不能是链接或特殊文件");
    }
  };
  walk(directory / "refs"); walk(directory / "logs");
  // Validate the whole list before deleting anything; never remove objects or arbitrary *.lock.
  for (const auto &path : locks) if (::unlink(path.c_str()) < 0) ioError("无法清理中断的 Git 锁");
}
fs::path filePath(const fs::path &root, const std::string &relative, bool allowRoot = false) {
  if (relative.empty()) { require(allowRoot, "需要文件路径"); return root; }
  safePath(relative); fs::path current = root;
  for (const auto &part : fs::path(relative).parent_path()) {
    current /= part; struct stat info;
    if (::lstat(current.c_str(), &info) == 0) require(S_ISDIR(info.st_mode) && !S_ISLNK(info.st_mode), "不允许跟随符号链接目录");
    else if (errno != ENOENT) ioError("无法检查目录");
  }
  return root / relative;
}
bool missingWorktreeParent(const fs::path &root, const std::string &relative) {
  safePath(relative); fs::path current = root;
  for (const auto &part : fs::path(relative).parent_path()) {
    current /= part; struct stat info;
    if (::lstat(current.c_str(), &info) < 0) { if (errno == ENOENT) return true; ioError("无法检查 Git 工作树目录"); }
    // Git paths beneath a file or symlink are absent; never traverse a link target.
    if (!S_ISDIR(info.st_mode)) return true;
  }
  return false;
}
void createParents(const fs::path &root, const std::string &relative) {
  fs::path current = root;
  for (const auto &part : fs::path(relative).parent_path()) {
    current /= part; struct stat info;
    if (::lstat(current.c_str(), &info) == 0) require(S_ISDIR(info.st_mode) && !S_ISLNK(info.st_mode), "不允许跟随符号链接目录");
    else { if (errno != ENOENT) ioError("无法检查目录"); if (::mkdir(current.c_str(), 0755) < 0 && errno != EEXIST) ioError("无法创建目录"); }
  }
}
void atomicBytes(const fs::path &root, const std::string &relative, const char *bytes, size_t size, unsigned mode, bool replaceLink = false) {
  auto path = filePath(root, relative); struct stat existing;
  bool exists = ::lstat(path.c_str(), &existing) == 0;
  require(!exists || S_ISREG(existing.st_mode) || (replaceLink && S_ISLNK(existing.st_mode)), "不能覆盖目录或特殊文件");
  createParents(root, relative);
  auto tempDirectory = root / ".git/agent-mobile/tmp"; fs::create_directories(tempDirectory);
  std::string name = (tempDirectory / "write-XXXXXX").string(); std::vector<char> tempName(name.begin(), name.end()); tempName.push_back('\0');
  int fd = ::mkstemp(tempName.data()); if (fd < 0) ioError("无法创建临时文件");
  try {
    size_t position = 0;
    while (position < size) {
      ssize_t count = ::write(fd, bytes + position, std::min(size - position, size_t(65536)));
      if (count < 0) { if (errno == EINTR) continue; ioError("文件写入失败"); }
      if (!count) throw Failure("STORAGE", "文件写入未取得进展");
      position += size_t(count);
    }
    if (::fchmod(fd, mode & 0777) < 0 || ::fsync(fd) < 0) ioError("文件同步失败");
    if (::close(fd) < 0) { fd = -1; ioError("文件关闭失败"); } fd = -1;
    if (::rename(tempName.data(), path.c_str()) < 0) ioError("文件替换失败");
  } catch (...) { if (fd >= 0) ::close(fd); ::unlink(tempName.data()); throw; }
}
Json fileOperation(const fs::path &root, const Json &request) {
  const std::string method = request.at("method");
  const auto relative = request.value("path", std::string());
  auto path = filePath(root, relative, method == "fileList" || method == "fileStat" || method == "fileMkdir");
  if (method == "fileMkdir") {
    if (relative.empty()) { fs::create_directories(root); return nullptr; }
    createParents(root, relative); struct stat existing;
    if (::lstat(path.c_str(), &existing) == 0) require(S_ISDIR(existing.st_mode), "目标不是目录");
    else if (::mkdir(path.c_str(), 0755) < 0) ioError("无法创建目录");
    return nullptr;
  }
  if (method == "fileWrite") {
    struct stat existing; bool exists = ::lstat(path.c_str(), &existing) == 0;
    require(!exists || S_ISREG(existing.st_mode), "不能通过正文写入修改目录或符号链接");
    auto bytes = decode(request.at("bytes"));
    atomicBytes(root, relative, bytes.data(), bytes.size(), exists ? existing.st_mode : 0644);
    return nullptr;
  }
  struct stat info; if (::lstat(path.c_str(), &info) < 0) ioError("无法读取文件属性");
  if (method == "fileExport") {
    require(S_ISREG(info.st_mode) || S_ISLNK(info.st_mode), "只能导出文件或链接内容");
    const fs::path directory = request.at("exportDirectory").get<std::string>();
    fs::create_directories(directory); const auto destination = directory / path.filename();
    int output = ::open(destination.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    if (output < 0) ioError("无法创建导出副本");
    int input = -1;
    try {
      auto writeAll = [&](const char *data, size_t length) {
        size_t offset = 0;
        while (offset < length) { auto count = ::write(output, data + offset, length - offset); if (count < 0) { if (errno == EINTR) continue; ioError("导出写入失败"); } if (!count) throw Failure("STORAGE", "导出未取得进展"); offset += size_t(count); }
      };
      if (S_ISLNK(info.st_mode)) { auto target = fs::read_symlink(path).string(); writeAll(target.data(), target.size()); }
      else {
        input = ::open(path.c_str(), O_RDONLY | O_NOFOLLOW); if (input < 0) ioError("无法读取导出文件");
        char buffer[65536];
        for (;;) { auto count = ::read(input, buffer, sizeof(buffer)); if (!count) break; if (count < 0) { if (errno == EINTR) continue; ioError("导出读取失败"); } writeAll(buffer, size_t(count)); }
        ::close(input); input = -1;
      }
      if (::fsync(output) < 0) ioError("导出同步失败"); ::close(output); output = -1;
      return destination.string();
    } catch (...) { if (input >= 0) ::close(input); if (output >= 0) ::close(output); ::unlink(destination.c_str()); throw; }
  }
  if (method == "fileStat") return {{"kind", S_ISDIR(info.st_mode) ? "directory" : S_ISLNK(info.st_mode) ? "symlink" : "file"},
    {"size", S_ISDIR(info.st_mode) ? 0 : info.st_size}, {"mode", unsigned(info.st_mode)}, {"mtime", int64_t(info.st_mtime) * 1000}};
  if (method == "fileList") {
    require(S_ISDIR(info.st_mode), "目标不是目录"); Json names = Json::array();
    for (const auto &entry : fs::directory_iterator(path)) names.push_back(entry.path().filename().string()); return names;
  }
  if (method == "fileRemove") {
    if (S_ISDIR(info.st_mode)) fs::remove_all(path);
    else if (::unlink(path.c_str()) < 0) ioError("无法删除文件");
    return nullptr;
  }
  if (method == "fileMove") {
    require(S_ISREG(info.st_mode) || S_ISLNK(info.st_mode), "仅允许移动文件或符号链接");
    const std::string destination = request.at("to"); auto target = filePath(root, destination); createParents(root, destination);
#ifdef __ANDROID__
    if (::syscall(SYS_renameat2, AT_FDCWD, path.c_str(), AT_FDCWD, target.c_str(), 1 /* RENAME_NOREPLACE */) < 0) ioError("无法移动文件");
#else
    if (::renamex_np(path.c_str(), target.c_str(), RENAME_EXCL) < 0) ioError("无法移动文件");
#endif
    return nullptr;
  }
  if (method == "fileRead" || method == "fileStamp") {
    require(!S_ISDIR(info.st_mode), "目标不是文件");
    if (method == "fileStamp" && S_ISREG(info.st_mode)) {
      git_oid oid; check(git_odb_hashfile(&oid, path.c_str(), GIT_OBJECT_BLOB)); return id(&oid);
    }
    std::string bytes;
    if (S_ISLNK(info.st_mode)) bytes = fs::read_symlink(path).string();
    else {
      int fd = ::open(path.c_str(), O_RDONLY | O_NOFOLLOW); if (fd < 0) ioError("文件不可读取");
      char buffer[65536];
      for (;;) {
        auto count = ::read(fd, buffer, sizeof(buffer)); if (count == 0) break;
        if (count < 0) { if (errno == EINTR) continue; ::close(fd); ioError("文件读取失败"); }
        bytes.append(buffer, size_t(count));
      }
      ::close(fd);
    }
    if (method == "fileStamp") { git_oid oid; check(git_odb_hash(&oid, bytes.data(), bytes.size(), GIT_OBJECT_BLOB)); return id(&oid); }
    return base64(bytes.data(), bytes.size());
  }
  throw Failure("VALIDATION", "不支持的文件操作");
}
/** App-owned repositories never use linked worktrees, alternate ODBs or redirected control paths. */
void validateRepositoryLayout(const fs::path &root) {
  const auto directory = root / ".git";
  struct stat info;
  if (::lstat(directory.c_str(), &info) < 0) { if (errno == ENOENT) return; ioError("无法检查 Git 目录"); }
  require(S_ISDIR(info.st_mode), "Git 目录必须位于项目内部，不能重定向");
  for (const auto *name : {"objects", "objects/info", "objects/pack", "refs", "logs", "agent-mobile", "agent-mobile/tmp", "agent-mobile/plans", "rebase-merge"}) {
    const auto path = directory / name;
    if (::lstat(path.c_str(), &info) < 0) { if (errno == ENOENT) continue; ioError("无法检查 Git 存储目录"); }
    require(S_ISDIR(info.st_mode), "Git 存储目录不能是链接或特殊文件");
  }
  for (const auto *name : {"HEAD", "config", "config.worktree", "index", "packed-refs", "shallow", "ORIG_HEAD", "FETCH_HEAD", "MERGE_HEAD", "MERGE_MSG", "MERGE_MODE", "REBASE_HEAD"}) {
    const auto path = directory / name;
    if (::lstat(path.c_str(), &info) < 0) { if (errno == ENOENT) continue; ioError("无法检查 Git 控制文件"); }
    require(S_ISREG(info.st_mode), "Git 控制文件不能是链接或特殊文件");
  }
  for (const auto *name : {"commondir", "gitdir", "objects/info/alternates", "objects/info/http-alternates"}) {
    if (::lstat((directory / name).c_str(), &info) == 0) throw Failure("VALIDATION", "Git 存储不能指向项目外部");
    if (errno != ENOENT) ioError("无法检查 Git 存储重定向");
  }
}
Repo open(const fs::path &root) {
  git_repository *value = nullptr;
  check(git_repository_open_ext(&value, root.c_str(), GIT_REPOSITORY_OPEN_NO_SEARCH, nullptr));
  Repo repo(value, git_repository_free);
  const auto *workdir = git_repository_workdir(value), *gitdir = git_repository_path(value), *common = git_repository_commondir(value);
  require(workdir && gitdir && common && fs::equivalent(workdir, root) && fs::equivalent(gitdir, root / ".git") && fs::equivalent(common, root / ".git"),
    "Git 工作树和元数据必须绑定当前项目");
  return repo;
}
Index index(git_repository *repo) {
  git_index *value = nullptr;
  check(git_repository_index(&value, repo));
  return Index(value, git_index_free);
}
std::string head(git_repository *repo) {
  git_oid value;
  int result = git_reference_name_to_id(&value, repo, "HEAD");
  if (result == GIT_ENOTFOUND || result == GIT_EUNBORNBRANCH) return "";
  check(result); return id(&value);
}
Json branch(git_repository *repo) {
  git_reference *value = nullptr;
  int result = git_reference_lookup(&value, repo, "HEAD");
  if (result == GIT_ENOTFOUND) return nullptr;
  check(result); Ref guard(value, git_reference_free);
  if (git_reference_type(value) != GIT_REFERENCE_SYMBOLIC) return nullptr;
  const std::string name = git_reference_symbolic_target(value);
  return name.rfind("refs/heads/", 0) == 0 ? Json(name.substr(11)) : Json(nullptr);
}
Config config(git_repository *repo) {
  git_config *value = nullptr;
  check(git_repository_config(&value, repo));
  return Config(value, git_config_free);
}
std::string configValue(git_repository *repo, const char *key) {
  auto cfg = config(repo); git_buf buffer = GIT_BUF_INIT;
  int result = git_config_get_string_buf(&buffer, cfg.get(), key);
  if (result == GIT_ENOTFOUND) return "";
  check(result); std::string value = buffer.ptr; git_buf_dispose(&buffer); return value;
}
Commit commitAt(git_repository *repo, const std::string &oid) {
  git_commit *value = nullptr; auto parsed = parseId(oid);
  check(git_commit_lookup(&value, repo, &parsed)); return Commit(value, git_commit_free);
}
Tree treeAt(git_repository *repo, const std::string &oid) {
  if (oid.empty()) return Tree(nullptr, git_tree_free);
  auto commit = commitAt(repo, oid); git_tree *value = nullptr;
  check(git_commit_tree(&value, commit.get())); return Tree(value, git_tree_free);
}
Blob blobAt(git_repository *repo, const std::string &oid) {
  git_blob *value = nullptr; auto parsed = parseId(oid);
  check(git_blob_lookup(&value, repo, &parsed)); return Blob(value, git_blob_free);
}
Json treeEntries(git_repository *repo, const std::string &oid) {
  auto tree = treeAt(repo, oid); Json entries = Json::array();
  if (!tree) return entries;
  check(git_tree_walk(tree.get(), GIT_TREEWALK_PRE, [](const char *prefix, const git_tree_entry *entry, void *data) {
    if (git_tree_entry_type(entry) == GIT_OBJECT_TREE) return 0;
    static_cast<Json *>(data)->push_back({{"path", std::string(prefix) + git_tree_entry_name(entry)},
      {"revision", id(git_tree_entry_id(entry))}, {"mode", unsigned(git_tree_entry_filemode(entry))}});
    return 0;
  }, &entries));
  return entries;
}
Json indexEntries(git_repository *repo) {
  auto idx = index(repo); Json entries = Json::array();
  for (size_t i = 0; i < git_index_entrycount(idx.get()); ++i) {
    const auto *entry = git_index_get_byindex(idx.get(), i);
    entries.push_back({{"path", entry->path}, {"revision", id(&entry->id)}, {"mode", entry->mode}, {"stage", GIT_INDEX_ENTRY_STAGE(entry)}});
  }
  return entries;
}
std::string createCommit(git_repository *repo, const git_oid &treeId, const std::vector<std::string> &parents,
                          const std::string &message, const char *ref, bool internal = false) {
  git_tree *treeValue = nullptr; check(git_tree_lookup(&treeValue, repo, &treeId)); Tree tree(treeValue, git_tree_free);
  git_signature *signatureValue = nullptr;
  if (internal) check(git_signature_now(&signatureValue, "Agent Mobile", "checkpoint@agentmobile.invalid"));
  else {
    auto name = configValue(repo, "user.name"), email = configValue(repo, "user.email");
    require(!name.empty() && !email.empty(), "请先设置 Git 提交姓名和邮箱");
    check(git_signature_now(&signatureValue, name.c_str(), email.c_str()));
  }
  Sig signature(signatureValue, git_signature_free);
  std::vector<Commit> holders; std::vector<const git_commit *> values;
  for (const auto &parent : parents) if (!parent.empty()) { holders.push_back(commitAt(repo, parent)); values.push_back(holders.back().get()); }
  git_oid oid;
  check(git_commit_create(&oid, repo, ref, signature.get(), signature.get(), nullptr, message.c_str(), tree.get(), values.size(), values.data()));
  return id(&oid);
}
std::string writeSnapshot(git_repository *repo, const Json &files, const std::string &ref, const std::string &parent) {
  git_index *value = nullptr; check(git_index_new(&value)); Index idx(value, git_index_free);
  git_odb *databaseValue = nullptr; check(git_repository_odb(&databaseValue, repo)); Ptr<git_odb, git_odb_free> database(databaseValue, git_odb_free);
  for (const auto &[path, object] : files.items()) {
    safePath(path);
    git_index_entry entry{}; entry.path = path.c_str();
    entry.mode = object.at("mode"); entry.id = parseId(object.at("revision"));
    require(entry.mode == GIT_FILEMODE_BLOB || entry.mode == GIT_FILEMODE_BLOB_EXECUTABLE || entry.mode == GIT_FILEMODE_LINK || entry.mode == GIT_FILEMODE_COMMIT, "无效文件模式");
    if (entry.mode != GIT_FILEMODE_COMMIT) {
      size_t size; git_object_t type;
      check(git_odb_read_header(&size, &type, database.get(), &entry.id)); require(type == GIT_OBJECT_BLOB, "快照对象不是文件");
    }
    check(git_index_add(idx.get(), &entry));
  }
  git_oid tree; check(git_index_write_tree_to(&tree, idx.get(), repo));
  return createCommit(repo, tree, {parent}, "Agent Mobile internal checkpoint", ref.c_str(), true);
}
Json treeMap(git_repository *repo, const std::string &oid) {
  Json out = Json::object();
  for (const auto &entry : treeEntries(repo, oid)) out[entry.at("path").get<std::string>()] = {{"revision", entry.at("revision")}, {"mode", entry.at("mode")}};
  return out;
}
Json indexMap(git_repository *repo, bool allowConflicts = false) {
  auto idx = index(repo);
  if (!allowConflicts && git_index_has_conflicts(idx.get())) throw Failure("CONFLICT", "请先解决合并冲突");
  Json out = Json::object();
  for (const auto &entry : indexEntries(repo)) if (entry.at("stage") == 0)
    out[entry.at("path").get<std::string>()] = {{"revision", entry.at("revision")}, {"mode", entry.at("mode")}};
  return out;
}
Json conflictsOf(git_index *idx) {
  Json conflicts = Json::array(); git_index_conflict_iterator *value = nullptr;
  check(git_index_conflict_iterator_new(&value, idx)); Ptr<git_index_conflict_iterator, git_index_conflict_iterator_free> iterator(value, git_index_conflict_iterator_free);
  const git_index_entry *base, *ours, *theirs; int result;
  while ((result = git_index_conflict_next(&base, &ours, &theirs, iterator.get())) == 0) {
    auto entry = [](const git_index_entry *e) -> Json { return e ? Json{{"path", safePath(e->path)}, {"oid", id(&e->id)}, {"mode", e->mode}} : Json(nullptr); };
    conflicts.push_back({{"path", ours ? ours->path : theirs ? theirs->path : base->path}, {"base", entry(base)}, {"ours", entry(ours)}, {"theirs", entry(theirs)}});
  }
  if (result != GIT_ITEROVER) check(result); return conflicts;
}
Json stateOfIndex(git_index *idx) {
  Json entries = Json::object();
  for (size_t i = 0; i < git_index_entrycount(idx); ++i) {
    const auto *entry = git_index_get_byindex(idx, i); safePath(entry->path);
    if (!GIT_INDEX_ENTRY_STAGE(entry)) entries[entry->path] = {{"revision", id(&entry->id)}, {"mode", entry->mode}};
  }
  return {{"entries", entries}, {"conflicts", conflictsOf(idx)}};
}
void addEntries(git_index *idx, const Json &entries) {
  require(entries.is_object(), "索引条目必须是路径映射");
  for (const auto &[path, object] : entries.items()) {
    safePath(path);
    if (object.is_null()) { int result = git_index_remove_bypath(idx, path.c_str()); if (result != GIT_ENOTFOUND) check(result); }
    else {
      git_index_entry entry{}; entry.path = path.c_str(); entry.id = parseId(object.at("revision")); entry.mode = object.at("mode");
      require(entry.mode == GIT_FILEMODE_BLOB || entry.mode == GIT_FILEMODE_BLOB_EXECUTABLE || entry.mode == GIT_FILEMODE_LINK || entry.mode == GIT_FILEMODE_COMMIT, "无效索引模式");
      check(git_index_add(idx, &entry));
    }
  }
}
void addConflicts(git_index *idx, const Json &conflicts) {
  for (const auto &conflict : conflicts) {
    git_index_entry values[3]{}; const git_index_entry *entries[3]{};
    const char *keys[] = {"base", "ours", "theirs"}; std::string paths[3];
    for (int i = 0; i < 3; ++i) if (!conflict.at(keys[i]).is_null()) {
      const auto &entry = conflict.at(keys[i]); paths[i] = safePath(entry.at("path"));
      values[i].path = paths[i].c_str(); values[i].id = parseId(entry.at("oid")); values[i].mode = entry.at("mode");
      require(values[i].mode == GIT_FILEMODE_BLOB || values[i].mode == GIT_FILEMODE_BLOB_EXECUTABLE || values[i].mode == GIT_FILEMODE_LINK || values[i].mode == GIT_FILEMODE_COMMIT, "无效冲突模式"); entries[i] = &values[i];
    }
    require(entries[0] || entries[1] || entries[2], "冲突缺少阶段");
    check(git_index_conflict_add(idx, entries[0], entries[1], entries[2]));
  }
}
Json workingEntry(git_repository *repo, const fs::path &root, const std::string &relative) {
  if (missingWorktreeParent(root, relative)) return nullptr;
  auto path = filePath(root, relative); struct stat info;
  if (::lstat(path.c_str(), &info) < 0) { if (errno == ENOENT) return nullptr; ioError("无法读取文件"); }
  git_oid oid; unsigned mode;
  if (S_ISLNK(info.st_mode)) {
    auto target = fs::read_symlink(path).string(); check(git_blob_create_frombuffer(&oid, repo, target.data(), target.size())); mode = GIT_FILEMODE_LINK;
  } else if (S_ISREG(info.st_mode)) {
    // create_from_disk applies clean filters to paths inside the worktree.
    // Recovery snapshots must preserve the exact bytes, including CRLF/BOM.
    git_odb *databaseValue = nullptr; check(git_repository_odb(&databaseValue, repo)); Ptr<git_odb, git_odb_free> database(databaseValue, git_odb_free);
    git_odb_stream *streamValue = nullptr;
    check(git_odb_open_wstream(&streamValue, database.get(), git_object_size_t(info.st_size), GIT_OBJECT_BLOB));
    Ptr<git_odb_stream, git_odb_stream_free> stream(streamValue, git_odb_stream_free);
    int fd = ::open(path.c_str(), O_RDONLY | O_NOFOLLOW); if (fd < 0) ioError("文件不可读取");
    try {
      char buffer[65536]; int64_t total = 0;
      for (;;) {
        ssize_t count = ::read(fd, buffer, sizeof(buffer)); if (!count) break;
        if (count < 0) { if (errno == EINTR) continue; ioError("文件读取失败"); }
        total += count;
        if (total > info.st_size) throw Failure("CONFLICT", "读取期间文件大小发生变化");
        check(git_odb_stream_write(stream.get(), buffer, size_t(count)));
      }
      if (total != info.st_size) throw Failure("CONFLICT", "读取期间文件大小发生变化");
      ::close(fd); fd = -1;
      check(git_odb_stream_finalize_write(&oid, stream.get()));
    } catch (...) { if (fd >= 0) ::close(fd); throw; }
    mode = info.st_mode & S_IXUSR ? GIT_FILEMODE_BLOB_EXECUTABLE : GIT_FILEMODE_BLOB;
  } else if (S_ISDIR(info.st_mode)) {
    auto idx = index(repo); const auto *entry = git_index_get_bypath(idx.get(), relative.c_str(), 0);
    if (!entry || entry->mode != GIT_FILEMODE_COMMIT) return nullptr;
    oid = entry->id; mode = GIT_FILEMODE_COMMIT;
  } else throw Failure("VALIDATION", "工作区不支持特殊设备文件");
  return {{"revision", id(&oid)}, {"mode", mode}};
}
Json workingTree(git_repository *repo, const fs::path &root, const Json &paths = Json()) {
  Json out = Json::object();
  if (!paths.is_null()) {
    for (const auto &path : paths) { auto value = workingEntry(repo, root, path); if (!value.is_null()) out[path.get<std::string>()] = value; }
    return out;
  }
  const auto tracked = indexMap(repo, true);
  std::function<void(const fs::path &, const std::string &)> visit = [&](const fs::path &directory, const std::string &prefix) {
    for (const auto &entry : fs::directory_iterator(directory)) {
      auto name = entry.path().filename().string(); if (name == ".git") continue;
      auto relative = prefix + name; safePath(relative);
      struct stat info; if (::lstat(entry.path().c_str(), &info) < 0) ioError("工作区扫描失败");
      if (S_ISDIR(info.st_mode) && !(tracked.contains(relative) && tracked.at(relative).at("mode") == unsigned(GIT_FILEMODE_COMMIT))) visit(entry.path(), relative + "/");
      else { auto value = workingEntry(repo, root, relative); if (!value.is_null()) out[relative] = value; }
    }
  };
  visit(root, ""); return out;
}
Json stagedEntries(git_repository *repo, const fs::path &root, const Json &paths) {
  auto original = index(repo); require(!git_index_has_conflicts(original.get()), "请先解决合并冲突");
  git_index *value = nullptr; check(git_index_new(&value)); Index temporary(value, git_index_free);
  for (size_t i = 0; i < git_index_entrycount(original.get()); ++i) check(git_index_add(temporary.get(), git_index_get_byindex(original.get(), i)));
  check(git_repository_set_index(repo, temporary.get()));
  Json out = Json::object();
  try {
    for (const auto &pathValue : paths) {
      const auto path = safePath(pathValue);
      if (missingWorktreeParent(root, path)) { out[path] = nullptr; continue; }
      auto full = filePath(root, path); struct stat info;
      if (::lstat(full.c_str(), &info) < 0) { if (errno == ENOENT) { out[path] = nullptr; continue; } ioError("暂存文件不可读取"); }
      const auto *existing = git_index_get_bypath(original.get(), path.c_str(), 0);
      if (S_ISDIR(info.st_mode) && (!existing || existing->mode != GIT_FILEMODE_COMMIT)) { out[path] = nullptr; continue; }
      if (!git_index_get_bypath(original.get(), path.c_str(), 0)) {
        int ignored = 0; check(git_ignore_path_is_ignored(&ignored, repo, path.c_str())); require(!ignored, "文件被 .gitignore 忽略");
      }
      check(git_index_add_bypath(temporary.get(), path.c_str()));
      const auto *entry = git_index_get_bypath(temporary.get(), path.c_str(), 0);
      require(entry != nullptr, "暂存文件不存在");
      out[path] = {{"revision", id(&entry->id)}, {"mode", entry->mode}};
    }
    check(git_repository_set_index(repo, original.get()));
  } catch (...) { git_repository_set_index(repo, original.get()); throw; }
  return out;
}
void writeEntry(git_repository *repo, const fs::path &root, const std::string &relative, const Json &entry) {
  auto path = filePath(root, relative);
  if (entry.is_null()) { if (::unlink(path.c_str()) < 0 && errno != ENOENT) ioError("文件删除失败"); return; }
  std::function<void(const fs::path &)> removeEmpty = [&](const fs::path &directory) {
    for (const auto &child : fs::directory_iterator(directory)) {
      struct stat info; if (::lstat(child.path().c_str(), &info) < 0) ioError("无法检查待替换目录");
      if (!S_ISDIR(info.st_mode)) throw Failure("CONFLICT", "目标目录仍有未处理内容，未覆盖当前文件");
      removeEmpty(child.path());
    }
    if (::rmdir(directory.c_str()) < 0) ioError("无法移除已清空的目录");
  };
  struct stat existing;
  if (::lstat(path.c_str(), &existing) == 0 && S_ISDIR(existing.st_mode)) removeEmpty(path);
  const unsigned mode = entry.at("mode");
  require(mode != GIT_FILEMODE_COMMIT, "子模块需要单独管理，不能作为普通文件修改");
  auto value = blobAt(repo, entry.at("revision")); const char *data = static_cast<const char *>(git_blob_rawcontent(value.get())); size_t size = git_blob_rawsize(value.get());
  if (mode == GIT_FILEMODE_LINK) {
    createParents(root, relative); auto tmp = root / ".git/agent-mobile/tmp"; fs::create_directories(tmp);
    auto pattern = (tmp / "link-XXXXXX").string(); std::vector<char> name(pattern.begin(), pattern.end()); name.push_back('\0');
    int fd = ::mkstemp(name.data()); if (fd < 0) ioError("无法准备符号链接"); ::close(fd); ::unlink(name.data());
    std::string target(data, size); require(target.find('\0') == std::string::npos, "符号链接目标无效");
    if (::symlink(target.c_str(), name.data()) < 0) ioError("无法创建符号链接");
    if (::rename(name.data(), path.c_str()) < 0) { ::unlink(name.data()); ioError("符号链接替换失败"); }
  } else { require(mode == GIT_FILEMODE_BLOB || mode == GIT_FILEMODE_BLOB_EXECUTABLE, "文件模式无效"); atomicBytes(root, relative, data, size, mode, true); }
}
void applyWorktree(git_repository *repo, const fs::path &root, const Json &request) {
  Json pending = Json::array();
  const auto actual = workingTree(repo, root); Json target = actual;
  for (const auto &change : request.at("changes")) {
    const auto path = safePath(change.at("path")); auto current = actual.value(path, Json());
    if (current != change.at("before") && current != change.at("after")) throw Failure("CONFLICT", "文件与恢复意图不匹配，未覆盖当前内容");
    if (!change.at("after").is_null()) {
      require(change.at("after").at("mode") != unsigned(GIT_FILEMODE_COMMIT), "子模块不能作为普通文件修改");
      auto verified = blobAt(repo, change.at("after").at("revision"));
    }
    if (current != change.at("after")) pending.push_back(change);
    if (change.at("after").is_null()) target.erase(path); else target[path] = change.at("after");
  }
  for (const auto &[path, entry] : target.items()) {
    for (auto parent = fs::path(path).parent_path(); !parent.empty(); parent = parent.parent_path())
      if (target.contains(parent.string())) throw Failure("CONFLICT", "文件与目录路径冲突，未覆盖现有内容");
  }
  if (request.contains("move") && !request.at("move").is_null() && pending.size() == 2) {
    auto from = request.at("move").at("from"), to = request.at("move").at("to"); const auto &changes = request.at("changes");
    require(changes.size() == 2 && changes[0].at("path") == from && changes[1].at("path") == to && changes[0].at("after").is_null() && changes[1].at("before").is_null() && changes[0].at("before") == changes[1].at("after"), "移动意图不匹配");
    fileOperation(root, {{"method", "fileMove"}, {"path", from}, {"to", to}});
  } else {
    std::stable_sort(pending.begin(), pending.end(), [](const Json &left, const Json &right) {
      const bool removedLeft = left.at("after").is_null(), removedRight = right.at("after").is_null();
      if (removedLeft != removedRight) return removedLeft;
      const auto a = left.at("path").get<std::string>().size(), b = right.at("path").get<std::string>().size();
      return removedLeft ? a > b : a < b;
    });
    for (const auto &change : pending) writeEntry(repo, root, change.at("path"), change.at("after"));
  }
  const auto result = workingTree(repo, root);
  for (const auto &change : request.at("changes")) {
    if (result.value(change.at("path").get<std::string>(), Json()) != change.at("after")) throw Failure("STORAGE", "文件写入结果与恢复意图不匹配");
  }
}
std::string checkpointRef(const std::string &key) {
  require(!key.empty() && key.find("..") == std::string::npos && key.find("//") == std::string::npos &&
    key.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-") == std::string::npos, "Invalid checkpoint key");
  return "refs/agent-mobile/checkpoints/" + key;
}
Json history(git_repository *repo, const Json &request) {
  auto query = request.value("query", Json::object());
  int limit = query.value("limit", 30), offset = 0;
  require(limit >= 1 && limit <= 100, "History page needs 1-100 commits");
  std::string anchor = query.value("head", head(repo));
  if (query.contains("cursor")) {
    Json cursor = Json::parse(query.at("cursor").get<std::string>());
    require(cursor.at("projectId") == request.at("projectId"), "History cursor belongs to another project");
    require(!query.contains("head") || query.at("head") == cursor.at("head"), "History cursor version changed");
    anchor = cursor.at("head"); offset = cursor.at("offset"); require(offset >= 0, "Invalid cursor");
  }
  Json versions = Json::array();
  if (anchor.empty()) return {{"head", nullptr}, {"versions", versions}};
  git_revwalk *walkerValue = nullptr; check(git_revwalk_new(&walkerValue, repo));
  Ptr<git_revwalk, git_revwalk_free> walker(walkerValue, git_revwalk_free);
  git_revwalk_sorting(walker.get(), GIT_SORT_TOPOLOGICAL | GIT_SORT_TIME);
  auto start = parseId(anchor); check(git_revwalk_push(walker.get(), &start));
  git_oid oid; int n = 0, result = 0; bool more = false;
  while ((result = git_revwalk_next(&oid, walker.get())) == 0) {
    if (n++ < offset) continue;
    if (versions.size() >= size_t(limit)) { more = true; break; }
    auto commit = commitAt(repo, id(&oid)); Json parents = Json::array();
    for (unsigned p = 0; p < git_commit_parentcount(commit.get()); ++p) parents.push_back(id(git_commit_parent_id(commit.get(), p)));
    const auto *author = git_commit_author(commit.get()), *committer = git_commit_committer(commit.get());
    versions.push_back({{"oid", id(&oid)}, {"parents", parents}, {"message", git_commit_message(commit.get())},
      {"timestamp", int64_t(author->when.time) * 1000}, {"author", {{"name", author->name}, {"email", author->email}}},
      {"committer", {{"name", committer->name}, {"email", committer->email}}}});
  }
  if (result != GIT_ITEROVER) check(result);
  Json output = {{"head", anchor}, {"versions", versions}};
  if (more) output["cursor"] = Json({{"head", anchor}, {"offset", offset + limit}, {"projectId", request.at("projectId")}}).dump();
  return output;
}
std::string repositoryState(git_repository *repo) {
  const int state = git_repository_state(repo);
  if (state == GIT_REPOSITORY_STATE_NONE) return "none";
  if (state == GIT_REPOSITORY_STATE_MERGE) return "merge";
  if (state == GIT_REPOSITORY_STATE_REBASE || state == GIT_REPOSITORY_STATE_REBASE_MERGE || state == GIT_REPOSITORY_STATE_REBASE_INTERACTIVE) return "rebase";
  return "other";
}
Json overview(git_repository *repo) {
  const auto current = head(repo); const auto name = branch(repo);
  Json branches = Json::array(), remotes = Json::array(), tags = Json::array();
  git_branch_iterator *iterator = nullptr; check(git_branch_iterator_new(&iterator, repo, GIT_BRANCH_ALL));
  Ptr<git_branch_iterator, git_branch_iterator_free> branchIterator(iterator, git_branch_iterator_free);
  git_reference *value = nullptr; git_branch_t type; int result;
  while ((result = git_branch_next(&value, &type, iterator)) == 0) {
    Ref ref(value, git_reference_free); const char *branchName = nullptr; check(git_branch_name(&branchName, value));
    git_reference *resolvedValue = nullptr;
    check(git_reference_resolve(&resolvedValue, value)); Ref resolved(resolvedValue, git_reference_free);
    Json item = {{"name", branchName}, {"remote", type == GIT_BRANCH_REMOTE}, {"current", name == branchName},
      {"oid", id(git_reference_target(resolvedValue))}};
    git_reference *upstream = nullptr;
    if (type == GIT_BRANCH_LOCAL && git_branch_upstream(&upstream, value) == 0) {
      Ref guard(upstream, git_reference_free); size_t ahead = 0, behind = 0;
      git_reference *resolvedUpstreamValue = nullptr; check(git_reference_resolve(&resolvedUpstreamValue, upstream)); Ref resolvedUpstream(resolvedUpstreamValue, git_reference_free);
      check(git_graph_ahead_behind(&ahead, &behind, repo, git_reference_target(resolvedValue), git_reference_target(resolvedUpstreamValue)));
      item["upstream"] = git_reference_shorthand(upstream); item["ahead"] = ahead; item["behind"] = behind;
    }
    branches.push_back(item);
  }
  if (result != GIT_ITEROVER) check(result);
  git_strarray names{}; check(git_remote_list(&names, repo));
  for (size_t i = 0; i < names.count; ++i) {
    git_remote *remoteValue = nullptr; check(git_remote_lookup(&remoteValue, repo, names.strings[i])); Remote remote(remoteValue, git_remote_free);
    remotes.push_back({{"name", names.strings[i]}, {"url", git_remote_url(remote.get()) ? git_remote_url(remote.get()) : ""}});
  }
  git_strarray_dispose(&names); check(git_tag_list(&names, repo));
  for (size_t i = 0; i < names.count; ++i) {
    git_oid target; std::string ref = "refs/tags/" + std::string(names.strings[i]);
    check(git_reference_name_to_id(&target, repo, ref.c_str())); tags.push_back({{"name", names.strings[i]}, {"oid", id(&target)}});
  }
  git_strarray_dispose(&names);
  Json conflicts = Json::array(); auto idx = index(repo);
  git_index_conflict_iterator *conflictValue = nullptr; check(git_index_conflict_iterator_new(&conflictValue, idx.get()));
  Ptr<git_index_conflict_iterator, git_index_conflict_iterator_free> conflictIterator(conflictValue, git_index_conflict_iterator_free);
  const git_index_entry *base, *ours, *theirs;
  while ((result = git_index_conflict_next(&base, &ours, &theirs, conflictIterator.get())) == 0) {
    auto entry = [](const git_index_entry *e) -> Json { return e ? Json{{"path", e->path}, {"oid", id(&e->id)}, {"mode", e->mode}} : Json(nullptr); };
    conflicts.push_back({{"path", ours ? ours->path : theirs ? theirs->path : base->path}, {"base", entry(base)}, {"ours", entry(ours)}, {"theirs", entry(theirs)}});
  }
  if (result != GIT_ITEROVER) check(result);
  const auto stateName = repositoryState(repo);
  Json changes = Json::array(); git_status_options statusOptions = GIT_STATUS_OPTIONS_INIT;
  statusOptions.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED | GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS;
  git_status_list *statusValue = nullptr; check(git_status_list_new(&statusValue, repo, &statusOptions));
  Ptr<git_status_list, git_status_list_free> status(statusValue, git_status_list_free);
  for (size_t i = 0; i < git_status_list_entrycount(statusValue); ++i) {
    const auto *entry = git_status_byindex(statusValue, i);
    const auto *delta = entry->index_to_workdir ? entry->index_to_workdir : entry->head_to_index;
    changes.push_back({{"path", delta->new_file.path ? delta->new_file.path : delta->old_file.path}, {"flags", entry->status}});
  }
  return {{"engine", "libgit2"}, {"version", LIBGIT2_VERSION}, {"head", {{"kind", current.empty() ? "unborn" : name.is_null() ? "detached" : "branch"}, {"oid", current.empty() ? Json(nullptr) : Json(current)}, {"branch", name}}},
    {"changes", changes},
    {"branches", branches}, {"remotes", remotes}, {"tags", tags}, {"state", stateName}, {"conflicts", conflicts},
    {"identity", {{"name", configValue(repo, "user.name")}, {"email", configValue(repo, "user.email")}}}};
}
std::string fingerprint(const Json &value) {
  const auto text = value.dump(); git_oid oid; check(git_odb_hash(&oid, text.data(), text.size(), GIT_OBJECT_BLOB)); return id(&oid);
}
Json uncommittedPaths(git_repository *repo, const Json &request) {
  // Use a bare view and an in-memory index so attributes come from the frozen
  // working snapshot, never from edits made after an interrupted task.
  git_repository *viewValue = nullptr; check(git_repository_open_bare(&viewValue, git_repository_path(repo)));
  Repo view(viewValue, git_repository_free);
  const std::string workingRef = request.at("workingSnapshot"), indexRef = request.at("indexSnapshot");
  const auto working = treeMap(view.get(), workingRef), staged = treeMap(view.get(), indexRef);
  const auto committed = treeMap(view.get(), request.at("head").is_null() ? "" : request.at("head").get<std::string>());
  auto frozen = treeAt(view.get(), workingRef);
  git_index *indexValue = nullptr; check(git_index_new(&indexValue)); Index memoryIndex(indexValue, git_index_free);
  check(git_index_read_tree(memoryIndex.get(), frozen.get())); check(git_repository_set_index(view.get(), memoryIndex.get()));
  Json out = Json::array();
  for (const auto &pathValue : request.at("paths")) {
    const std::string path = safePath(pathValue);
    Json headEntry = committed.value(path, Json()), indexEntry = staged.value(path, Json()), workingValue = working.value(path, Json());
    if (headEntry != indexEntry) { out.push_back(path); continue; }
    if (!workingValue.is_null() && (workingValue.at("mode") == unsigned(GIT_FILEMODE_BLOB) || workingValue.at("mode") == unsigned(GIT_FILEMODE_BLOB_EXECUTABLE))) {
      auto value = blobAt(view.get(), workingValue.at("revision"));
      git_filter_options options = GIT_FILTER_OPTIONS_INIT;
      options.flags = GIT_FILTER_ATTRIBUTES_FROM_COMMIT;
      options.attr_commit_id = parseId(workingRef);
      git_filter_list *filterValue = nullptr;
      check(git_filter_list_load_ext(&filterValue, view.get(), value.get(), path.c_str(), GIT_FILTER_TO_ODB, &options));
      Ptr<git_filter_list, git_filter_list_free> filters(filterValue, git_filter_list_free);
      if (filterValue) {
        git_buf filtered = GIT_BUF_INIT; int result = git_filter_list_apply_to_blob(&filtered, filterValue, value.get());
        if (result < 0) { git_buf_dispose(&filtered); check(result); }
        git_oid oid; result = git_odb_hash(&oid, filtered.ptr, filtered.size, GIT_OBJECT_BLOB); git_buf_dispose(&filtered); check(result);
        workingValue["revision"] = id(&oid);
      }
    }
    if (indexEntry != workingValue) out.push_back(path);
  }
  return out;
}
Json headState(git_repository *repo) {
  auto value = head(repo); return {{"branch", branch(repo)}, {"oid", value.empty() ? Json(nullptr) : Json(value)}};
}
Json materializedTree(git_repository *repo, const std::string &commitId) {
  const auto target = treeMap(repo, commitId);
  git_repository *viewValue = nullptr; check(git_repository_open_bare(&viewValue, git_repository_path(repo))); Repo view(viewValue, git_repository_free);
  auto frozen = treeAt(view.get(), commitId);
  git_index *indexValue = nullptr; check(git_index_new(&indexValue)); Index memoryIndex(indexValue, git_index_free);
  check(git_index_read_tree(memoryIndex.get(), frozen.get())); check(git_repository_set_index(view.get(), memoryIndex.get()));
  Json out = target;
  for (const auto &[path, entry] : target.items()) {
    const unsigned mode = entry.at("mode");
    if (mode != GIT_FILEMODE_BLOB && mode != GIT_FILEMODE_BLOB_EXECUTABLE) continue;
    git_filter_options options = GIT_FILTER_OPTIONS_INIT; options.flags = GIT_FILTER_ATTRIBUTES_FROM_COMMIT; options.attr_commit_id = parseId(commitId);
    git_filter_list *filterValue = nullptr;
    check(git_filter_list_load_ext(&filterValue, view.get(), nullptr, path.c_str(), GIT_FILTER_TO_WORKTREE, &options));
    Ptr<git_filter_list, git_filter_list_free> filters(filterValue, git_filter_list_free);
    if (!filterValue) continue;
    auto value = blobAt(view.get(), entry.at("revision")); git_buf filtered = GIT_BUF_INIT;
    int result = git_filter_list_apply_to_blob(&filtered, filterValue, value.get());
    if (result < 0) { git_buf_dispose(&filtered); check(result); }
    git_oid oid; result = git_blob_create_frombuffer(&oid, view.get(), filtered.ptr, filtered.size); git_buf_dispose(&filtered); check(result);
    out[path]["revision"] = id(&oid);
  }
  return out;
}
Json status(git_repository *repo, const fs::path &root, const Json &request) {
  const auto current = head(repo); const auto committed = treeMap(repo, current), staged = indexMap(repo, true);
  Json working = Json::object();
  if (request.contains("working") && request.at("working").is_array()) {
    for (const auto &entry : request.at("working")) working[entry.at("path").get<std::string>()] = {{"revision", entry.at("revision")}, {"mode", entry.value("mode", unsigned(GIT_FILEMODE_BLOB))}};
  } else working = workingTree(repo, root);
  git_status_options options = GIT_STATUS_OPTIONS_INIT;
  options.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED | GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS;
  git_status_list *value = nullptr; check(git_status_list_new(&value, repo, &options));
  Ptr<git_status_list, git_status_list_free> list(value, git_status_list_free); Json files = Json::array();
  for (size_t i = 0; i < git_status_list_entrycount(value); ++i) {
    const auto *entry = git_status_byindex(value, i);
    const auto *delta = entry->index_to_workdir ? entry->index_to_workdir : entry->head_to_index;
    std::string path = delta->new_file.path ? delta->new_file.path : delta->old_file.path;
    auto revision = [&](const Json &tree) -> Json { return tree.contains(path) ? tree.at(path).at("revision") : Json(nullptr); };
    auto mode = [&](const Json &tree) -> Json { return tree.contains(path) ? tree.at(path).at("mode") : Json(nullptr); };
    Json file = {{"path", path}, {"headRevision", revision(committed)}, {"indexRevision", revision(staged)}, {"workingRevision", revision(working)},
      {"headMode", mode(committed)}, {"indexMode", mode(staged)}, {"workingMode", mode(working)}};
    const auto flags = entry->status;
    if (flags & (GIT_STATUS_INDEX_NEW | GIT_STATUS_INDEX_MODIFIED | GIT_STATUS_INDEX_DELETED | GIT_STATUS_INDEX_RENAMED | GIT_STATUS_INDEX_TYPECHANGE))
      file["staged"] = flags & GIT_STATUS_INDEX_NEW ? "added" : flags & GIT_STATUS_INDEX_DELETED ? "deleted" : "modified";
    if (flags & (GIT_STATUS_WT_NEW | GIT_STATUS_WT_MODIFIED | GIT_STATUS_WT_DELETED | GIT_STATUS_WT_RENAMED | GIT_STATUS_WT_TYPECHANGE | GIT_STATUS_WT_UNREADABLE | GIT_STATUS_CONFLICTED))
      file["unstaged"] = flags & GIT_STATUS_WT_NEW ? "added" : flags & GIT_STATUS_WT_DELETED ? "deleted" : "modified";
    if (flags & GIT_STATUS_CONFLICTED) file["conflict"] = true;
    files.push_back(file);
  }
  const auto state = repositoryState(repo);
  return {{"head", current.empty() ? Json(nullptr) : Json(current)}, {"branch", branch(repo)}, {"state", state}, {"files", files},
    {"indexRevision", fingerprint(indexEntries(repo))}, {"workingRevision", fingerprint(working)}};
}
bool isCancelled(am_git_callbacks &callbacks) { return callbacks.cancelled && callbacks.cancelled(callbacks.context); }
std::string httpsOrigin(const std::string &url) {
  require(url.rfind("https://", 0) == 0 && url.find('@') == std::string::npos && url.find('?') == std::string::npos && url.find('#') == std::string::npos && url.find_first_of("\r\n\\") == std::string::npos, "请使用不含凭证的 HTTPS 仓库地址");
  const auto end = url.find('/', 8); auto origin = url.substr(0, end);
  require(origin.size() > 8, "仓库地址缺少主机名");
  std::transform(origin.begin(), origin.end(), origin.begin(), [](unsigned char c) { return std::tolower(c); }); return origin;
}
struct Transfer {
  am_git_callbacks callbacks;
  Json credential;
  std::string origin;
  unsigned challenges = 0;
  bool negotiated = false, conflict = false, rejected = false, confirmed = false;
  std::string expected, destination, wanted;
};
git_remote_callbacks remoteCallbacks(Transfer *transfer) {
  git_remote_callbacks options = GIT_REMOTE_CALLBACKS_INIT;
  options.payload = transfer;
  options.credentials = [](git_credential **out, const char *url, const char *, unsigned allowed, void *payload) {
    auto &t = *static_cast<Transfer *>(payload);
    if (isCancelled(t.callbacks)) return int(GIT_EUSER);
    if (!(allowed & GIT_CREDENTIAL_USERPASS_PLAINTEXT) || t.credential.is_null() || t.challenges++ > 0) return int(GIT_EAUTH);
    try {
      if (httpsOrigin(url) != t.origin) return int(GIT_EAUTH);
      const auto username = t.credential.at("username").get<std::string>(), password = t.credential.at("password").get<std::string>();
      return git_credential_userpass_plaintext_new(out, username.c_str(), password.c_str());
    } catch (...) { return int(GIT_EAUTH); }
  };
  options.transfer_progress = [](const git_indexer_progress *p, void *data) {
    auto &c = static_cast<Transfer *>(data)->callbacks;
    if (c.progress) c.progress(c.context, "transfer", p->received_objects, p->total_objects, p->received_bytes);
    return isCancelled(c) ? GIT_EUSER : 0;
  };
  options.sideband_progress = [](const char *, int, void *data) { return isCancelled(static_cast<Transfer *>(data)->callbacks) ? GIT_EUSER : 0; };
  options.push_transfer_progress = [](unsigned current, unsigned total, size_t bytes, void *data) {
    auto &c = static_cast<Transfer *>(data)->callbacks;
    if (c.progress) c.progress(c.context, "push", current, total, bytes);
    return isCancelled(c) ? GIT_EUSER : 0;
  };
  options.pack_progress = [](int, uint32_t current, uint32_t total, void *data) {
    auto &c = static_cast<Transfer *>(data)->callbacks;
    if (c.progress) c.progress(c.context, "pack", current, total, 0);
    return isCancelled(c) ? GIT_EUSER : 0;
  };
  options.push_negotiation = [](const git_push_update **updates, size_t count, void *data) {
    auto &t = *static_cast<Transfer *>(data);
    if (isCancelled(t.callbacks)) return int(GIT_EUSER);
    for (size_t i = 0; i < count; ++i) {
      const auto *update = updates[i];
      const auto before = git_oid_is_zero(&update->src) ? std::string() : id(&update->src);
      if (t.destination != update->dst_refname || before != t.expected || id(&update->dst) != t.wanted) { t.conflict = true; return int(GIT_EUSER); }
    }
    t.negotiated = true; return 0;
  };
  options.push_update_reference = [](const char *, const char *status, void *data) {
    auto &t = *static_cast<Transfer *>(data); if (status) t.rejected = true; else t.confirmed = true; return 0;
  };
  return options;
}
Transfer transferContext(git_remote *remote, const Json &request, am_git_callbacks callbacks) {
  const auto *url = git_remote_url(remote); require(url != nullptr, "远程地址不存在");
  auto origin = httpsOrigin(url);
  const auto *push = git_remote_pushurl(remote);
  require(!push || std::string(push) == url, "当前请将推送和获取配置为同一个 HTTPS 仓库地址");
  return {callbacks, request.value("credential", Json()), origin};
}
void checkTransfer(int result, Transfer &transfer, bool push = false) {
  if (result >= 0 && !transfer.rejected) return;
  const auto *error = git_error_last(); const std::string reason = error && error->message ? error->message : "";
  if (transfer.conflict || result == GIT_ENONFASTFORWARD) throw Failure("CONFLICT", "远程分支已变化或不是快进，请先获取并合并后重试");
  if (transfer.rejected) throw Failure("REMOTE", "服务器拒绝推送，请检查分支保护和仓库权限");
  if (push && transfer.negotiated) throw Failure("UNKNOWN", transfer.confirmed ? "服务器已确认推送，但本地收尾失败，请核对远程分支" : "推送结果尚未确认，请核对远程分支后再继续", true);
  if (isCancelled(transfer.callbacks)) throw Failure("CANCELLED", "Git 传输已取消");
  if (result == GIT_EAUTH) throw Failure("REMOTE", "Git 认证失败，请检查用户名、令牌和仓库权限");
  if (reason.find("redirect") != std::string::npos) throw Failure("REMOTE", "仓库地址发生重定向，请使用最终的 HTTPS 仓库地址");
  if (reason.find("SSLHandshakeException") != std::string::npos || reason.find("certificate") != std::string::npos) throw Failure("REMOTE", "HTTPS 证书验证失败，请检查服务器证书和设备时间");
  if (reason.find("SocketTimeoutException") != std::string::npos || reason.find("timed out") != std::string::npos) throw Failure("REMOTE", "连接 Git 服务器超时，请检查网络后重试");
  if (reason.find("UnknownHostException") != std::string::npos) throw Failure("REMOTE", "无法解析 Git 服务器地址，请检查网络和仓库地址");
  if (reason.find("SocketException") != std::string::npos) throw Failure("REMOTE", "与 Git 服务器的连接已断开，请检查网络后重试");
  throw Failure("REMOTE", "Git 传输失败，请检查仓库地址、网络和认证信息");
}
void requireClean(git_repository *repo) {
  require(git_repository_state(repo) == GIT_REPOSITORY_STATE_NONE, "请先完成或中止正在进行的 Git 操作");
  git_status_options options = GIT_STATUS_OPTIONS_INIT;
  options.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED | GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS;
  git_status_list *value = nullptr; check(git_status_list_new(&value, repo, &options));
  Ptr<git_status_list, git_status_list_free> list(value, git_status_list_free);
  require(git_status_list_entrycount(value) == 0, "请先提交、暂存保存或丢弃工作区更改");
}
Json switchPlan(git_repository *repo, const fs::path &root, const std::string &target) {
  requireClean(repo);
  auto commit = commitAt(repo, target);
  git_checkout_options options = GIT_CHECKOUT_OPTIONS_INIT;
  options.checkout_strategy = GIT_CHECKOUT_SAFE | GIT_CHECKOUT_DRY_RUN | GIT_CHECKOUT_DONT_OVERWRITE_IGNORED;
  check(git_checkout_tree(repo, reinterpret_cast<git_object *>(commit.get()), &options));
  const auto beforeTree = treeMap(repo, head(repo)), index = treeMap(repo, target), desired = materializedTree(repo, target), working = workingTree(repo, root);
  std::set<std::string> paths;
  for (const auto &[path, entry] : beforeTree.items()) paths.insert(path);
  for (const auto &[path, entry] : index.items()) paths.insert(path);
  Json changes = Json::array();
  for (const auto &path : paths) {
    auto before = working.value(path, Json()), after = desired.value(path, Json());
    if (before == after) continue;
    require((before.is_null() || before.at("mode") != unsigned(GIT_FILEMODE_COMMIT)) && (after.is_null() || after.at("mode") != unsigned(GIT_FILEMODE_COMMIT)), "当前尚未支持切换涉及子模块变化的分支");
    changes.push_back({{"path", path}, {"before", before}, {"after", after}});
  }
  return {{"changes", changes}, {"index", index}};
}
void changeHead(git_repository *repo, const Json &before, const Json &after, const Json &branchGuard = Json()) {
  const auto current = headState(repo);
  if (current == after) return;
  if (current != before) throw Failure("CONFLICT", "当前分支或提交与切换意图不匹配");
  if (!after.at("branch").is_null()) {
    const std::string ref = "refs/heads/" + after.at("branch").get<std::string>();
    git_oid target; int result = git_reference_name_to_id(&target, repo, ref.c_str());
    if (result != GIT_ENOTFOUND) check(result);
    Json targetId = result == GIT_ENOTFOUND ? Json(nullptr) : Json(id(&target));
    const auto expected = branchGuard.is_null() ? before.at("oid") : branchGuard.at("oid");
    if (!branchGuard.is_null()) {
      require(before.at("branch").is_null() && after.at("branch") == branchGuard.at("name") && expected.is_string(), "变基分支保护无效");
      parseId(expected);
      if (targetId != expected && targetId != after.at("oid")) throw Failure("CONFLICT", "原分支已变化，拒绝更新变基结果");
    }
    if (targetId != after.at("oid")) {
      if ((branchGuard.is_null() && after.at("branch") != before.at("branch")) || targetId != expected || after.at("oid").is_null()) throw Failure("CONFLICT", "目标分支已变化");
      git_oid wanted = parseId(after.at("oid")); git_reference *created = nullptr;
      if (targetId.is_null()) check(git_reference_create(&created, repo, ref.c_str(), &wanted, 0, "Agent Mobile reference update"));
      else check(git_reference_create_matching(&created, repo, ref.c_str(), &wanted, 1, &target, "Agent Mobile reference update"));
      git_reference_free(created);
    }
    check(git_repository_set_head(repo, ref.c_str()));
  } else {
    require(!after.at("oid").is_null(), "分离 HEAD 需要明确提交"); auto oid = parseId(after.at("oid")); check(git_repository_set_head_detached(repo, &oid));
  }
}

bool pathExists(const fs::path &path) {
  struct stat info; if (::lstat(path.c_str(), &info) == 0) return true;
  if (errno == ENOENT) return false; ioError("无法检查克隆目录"); return false;
}
void privateBytes(const fs::path &path, const std::string &content) {
  auto name = (path.parent_path() / (".agent-mobile-state-" + path.filename().string() + "-XXXXXX")).string();
  std::vector<char> temporary(name.begin(), name.end()); temporary.push_back('\0');
  int fd = ::mkstemp(temporary.data()); if (fd < 0) ioError("无法保存克隆回执");
  try {
    size_t offset = 0;
    while (offset < content.size()) { auto count = ::write(fd, content.data() + offset, content.size() - offset); if (count < 0) { if (errno == EINTR) continue; ioError("无法写入克隆回执"); } if (!count) throw Failure("STORAGE", "克隆回执写入未取得进展"); offset += size_t(count); }
    if (::fsync(fd) < 0) ioError("无法同步克隆回执");
    ::close(fd); fd = -1;
    if (::rename(temporary.data(), path.c_str()) < 0) ioError("无法发布克隆回执");
  } catch (...) { if (fd >= 0) ::close(fd); ::unlink(temporary.data()); throw; }
}
void privateJson(const fs::path &path, const Json &value) { privateBytes(path, value.dump()); }
std::string cloneState(const fs::path &root, const Json &request) {
  const auto staging = root.parent_path() / "clone-staging", receipt = root.parent_path() / "clone-ready.json";
  if (!pathExists(receipt)) { require(!pathExists(root), "克隆目标已有文件"); return pathExists(staging) ? "incomplete" : "absent"; }
  struct stat info; if (::lstat(receipt.c_str(), &info) < 0) ioError("无法读取克隆回执"); require(S_ISREG(info.st_mode), "克隆回执不是普通文件");
  Json saved; std::ifstream(receipt) >> saved;
  require(saved.at("url") == request.at("url") && saved.at("operationId") == request.at("operationId"), "克隆回执与当前意图不匹配");
  const bool published = pathExists(root);
  auto repo = open(published ? root : staging);
  require(configValue(repo.get(), "remote.origin.url") == request.at("url"), "克隆来源与当前意图不匹配");
  require((head(repo.get()).empty() ? Json(nullptr) : Json(head(repo.get()))) == saved.at("head"), "克隆提交与回执不匹配");
  return published ? "published" : "ready";
}
void publishClone(const fs::path &root, const Json &request) {
  const auto state = cloneState(root, request);
  if (state == "published") return;
  require(state == "ready", "克隆尚未完成，不能发布项目");
  auto source = root.parent_path() / "clone-staging";
#ifdef __ANDROID__
  if (::syscall(SYS_renameat2, AT_FDCWD, source.c_str(), AT_FDCWD, root.c_str(), 1 /* RENAME_NOREPLACE */) < 0) ioError("无法发布克隆仓库");
#else
  if (::renamex_np(source.c_str(), root.c_str(), RENAME_EXCL) < 0) ioError("无法发布克隆仓库");
#endif
}
Json cloneOperation(const fs::path &root, const Json &request, am_git_callbacks callbacks) {
  const auto method = request.at("method").get<std::string>();
  const auto staging = root.parent_path() / "clone-staging", receipt = root.parent_path() / "clone-ready.json";
  if (method == "discardClone") {
    require(!pathExists(root), "已发布的项目不能作为克隆临时目录清理");
    fs::remove_all(staging); fs::remove(receipt); return nullptr;
  }
  if (method == "cloneState") return cloneState(root, request);
  if (method == "publishClone") { publishClone(root, request); return nullptr; }
  require(method == "clone", "未知克隆操作");
  const auto state = cloneState(root, request);
  if (state == "ready" || state == "published") { requireActive(callbacks); publishClone(root, request); return nullptr; }
  require(state == "absent", "克隆暂存目录已有未完成数据，请先恢复或清理该次导入");
  const auto url = request.at("url").get<std::string>();
  Transfer transfer{callbacks, request.value("credential", Json()), httpsOrigin(url)};
  git_clone_options options = GIT_CLONE_OPTIONS_INIT;
  options.fetch_opts.callbacks = remoteCallbacks(&transfer); options.fetch_opts.follow_redirects = GIT_REMOTE_REDIRECT_NONE;
  options.checkout_opts.notify_flags = GIT_CHECKOUT_NOTIFY_ALL;
  options.checkout_opts.notify_payload = &transfer;
  options.checkout_opts.notify_cb = [](git_checkout_notify_t, const char *, const git_diff_file *, const git_diff_file *, const git_diff_file *, void *payload) { return isCancelled(static_cast<Transfer *>(payload)->callbacks) ? int(GIT_EUSER) : 0; };
  options.checkout_opts.progress_payload = &transfer;
  options.checkout_opts.progress_cb = [](const char *, size_t completed, size_t total, void *payload) { auto &c = static_cast<Transfer *>(payload)->callbacks; if (c.progress) c.progress(c.context, "checkout", unsigned(completed), unsigned(total), 0); };
  git_repository *value = nullptr;
  int result = git_clone(&value, url.c_str(), staging.c_str(), &options); Repo repo(value, git_repository_free);
  checkTransfer(result, transfer); requireActive(callbacks);
  auto current = head(repo.get()); treeEntries(repo.get(), current); // Validate every tracked path before publication.
  auto cfg = config(repo.get()); check(git_config_set_string(cfg.get(), "user.name", "Agent Mobile")); check(git_config_set_string(cfg.get(), "user.email", "local@agentmobile.invalid"));
  privateJson(receipt, {{"operationId", request.at("operationId")}, {"url", url}, {"head", current.empty() ? Json(nullptr) : Json(current)}});
  repo.reset(); requireActive(callbacks); publishClone(root, request); return nullptr;
}

const std::vector<std::string> stateNames{"MERGE_HEAD", "MERGE_MSG", "MERGE_MODE", "ORIG_HEAD", "REBASE_HEAD",
  "rebase-merge/interactive", "rebase-merge/head-name", "rebase-merge/orig-head", "rebase-merge/onto",
  "rebase-merge/git-rebase-todo", "rebase-merge/done", "rebase-merge/msgnum", "rebase-merge/end",
  "rebase-merge/stopped-sha", "rebase-merge/message", "rebase-merge/author-script", "rebase-merge/rewritten-list", "rebase-merge/quiet"};
bool stateTemporary(const std::string &name, bool rebase = true) {
  for (const auto &field : stateNames) if ((field.rfind("rebase-merge/", 0) == 0) == rebase) {
    const auto prefix = ".agent-mobile-state-" + fs::path(field).filename().string() + "-";
    if (name.rfind(prefix, 0) == 0 && name.size() == prefix.size() + 6 && std::all_of(name.begin() + prefix.size(), name.end(), [](unsigned char c) { return std::isalnum(c); })) return true;
  }
  return false;
}
std::vector<fs::path> rootStateTemporaries(git_repository *repo) {
  std::vector<fs::path> files;
  for (const auto &entry : fs::directory_iterator(git_repository_path(repo))) {
    if (!stateTemporary(entry.path().filename().string(), false)) continue;
    struct stat info; if (::lstat(entry.path().c_str(), &info) < 0) ioError("无法读取 Git 临时状态");
    require(S_ISREG(info.st_mode) && info.st_size <= 65536, "Git 临时状态无效"); files.push_back(entry.path());
  }
  return files;
}
Json gitState(git_repository *repo) {
  rootStateTemporaries(repo);
  Json result = Json::object();
  const auto rebase = fs::path(git_repository_path(repo)) / "rebase-merge";
  struct stat directoryInfo;
  if (::lstat(rebase.c_str(), &directoryInfo) == 0) {
    require(S_ISDIR(directoryInfo.st_mode), "变基状态目录无效");
    for (const auto &entry : fs::directory_iterator(rebase)) {
      if (stateTemporary(entry.path().filename().string())) {
        struct stat info; if (::lstat(entry.path().c_str(), &info) < 0) ioError("无法读取变基临时状态");
        require(S_ISREG(info.st_mode) && info.st_size <= 65536, "变基临时状态无效"); continue;
      }
      const auto name = "rebase-merge/" + entry.path().filename().string();
      require(std::find(stateNames.begin(), stateNames.end(), name) != stateNames.end(), "变基状态含有尚未支持的文件，请保留现场");
    }
  } else if (errno != ENOENT) ioError("无法读取变基状态目录");
  for (const auto &name : stateNames) {
    auto path = fs::path(git_repository_path(repo)) / name; struct stat info;
    if (::lstat(path.c_str(), &info) < 0) { if (errno == ENOENT) { result[name] = nullptr; continue; } ioError("无法读取 Git 操作状态"); }
    require(S_ISREG(info.st_mode) && info.st_size <= 65536, "Git 状态文件无效");
    int fd = ::open(path.c_str(), O_RDONLY | O_NOFOLLOW); if (fd < 0) ioError("无法读取 Git 操作状态");
    std::string bytes; char buffer[4096];
    for (;;) { auto count = ::read(fd, buffer, sizeof(buffer)); if (!count) break; if (count < 0) { if (errno == EINTR) continue; ::close(fd); ioError("Git 状态读取失败"); } bytes.append(buffer, size_t(count)); if (bytes.size() > 65536) { ::close(fd); throw Failure("STORAGE", "Git 状态过大"); } }
    ::close(fd); result[name] = bytes;
  }
  return result;
}
void applyGitState(git_repository *repo, const Json &before, const Json &after) {
  require(before.is_object() && after.is_object(), "Git 状态字段无效");
  for (const auto *state : {&before, &after}) for (const auto &[name, value] : state->items()) {
    require(std::find(stateNames.begin(), stateNames.end(), name) != stateNames.end(), "Git 状态字段无效");
    require(value.is_null() || (value.is_string() && value.get<std::string>().size() <= 65536), "Git 状态内容无效");
  }
  const auto actual = gitState(repo);
  for (const auto &name : stateNames) {
    if (actual.at(name) != before.value(name, Json()) && actual.at(name) != after.value(name, Json())) throw Failure("CONFLICT", "Git 状态与恢复意图不匹配");
  }
  const auto directory = fs::path(git_repository_path(repo)) / "rebase-merge";
  const bool keepsRebase = std::any_of(stateNames.begin(), stateNames.end(), [&](const auto &name) { return name.rfind("rebase-merge/", 0) == 0 && !after.value(name, Json()).is_null(); });
  if (keepsRebase) fs::create_directory(directory);
  for (const auto &name : stateNames) if (actual.at(name) != after.value(name, Json())) {
    auto path = fs::path(git_repository_path(repo)) / name;
    if (after.value(name, Json()).is_null()) { if (::unlink(path.c_str()) < 0 && errno != ENOENT) ioError("无法清理 Git 状态"); }
    else privateBytes(path, after.at(name).get<std::string>());
  }
  if (fs::exists(directory)) for (const auto &entry : fs::directory_iterator(directory))
    if (stateTemporary(entry.path().filename().string())) fs::remove(entry.path());
  for (const auto &path : rootStateTemporaries(repo)) fs::remove(path);
  if (!keepsRebase && fs::exists(directory)) require(fs::remove(directory), "无法清理变基状态目录");
}
Json filterEntries(git_repository *repo, const Json &entries, const std::string &attributes, bool clean) {
  git_repository *viewValue = nullptr; check(git_repository_open_bare(&viewValue, git_repository_path(repo))); Repo view(viewValue, git_repository_free);
  auto frozen = treeAt(view.get(), attributes); git_index *value = nullptr; check(git_index_new(&value)); Index idx(value, git_index_free);
  check(git_index_read_tree(value, frozen.get())); check(git_repository_set_index(view.get(), value));
  Json out = entries;
  for (const auto &[path, entry] : entries.items()) {
    safePath(path); const unsigned mode = entry.at("mode");
    if (mode != GIT_FILEMODE_BLOB && mode != GIT_FILEMODE_BLOB_EXECUTABLE) continue;
    auto blob = blobAt(view.get(), entry.at("revision"));
    git_filter_options options = GIT_FILTER_OPTIONS_INIT; options.flags = GIT_FILTER_ATTRIBUTES_FROM_COMMIT; options.attr_commit_id = parseId(attributes);
    git_filter_list *filtersValue = nullptr; check(git_filter_list_load_ext(&filtersValue, view.get(), blob.get(), path.c_str(), clean ? GIT_FILTER_TO_ODB : GIT_FILTER_TO_WORKTREE, &options));
    Ptr<git_filter_list, git_filter_list_free> filters(filtersValue, git_filter_list_free);
    if (!filtersValue) continue;
    git_buf bytes = GIT_BUF_INIT; int result = git_filter_list_apply_to_blob(&bytes, filtersValue, blob.get());
    if (result < 0) { git_buf_dispose(&bytes); check(result); }
    git_oid oid; result = git_blob_create_frombuffer(&oid, view.get(), bytes.ptr, bytes.size); git_buf_dispose(&bytes); check(result); out[path]["revision"] = id(&oid);
  }
  return out;
}
std::string commitEntries(git_repository *repo, const Json &entries, const std::vector<std::string> &parents, const std::string &message) {
  require(entries.is_object(), "提交条目必须是路径映射");
  for (const auto &[path, entry] : entries.items()) require(!entry.is_null(), "提交条目不能包含删除操作");
  git_index *value = nullptr; check(git_index_new(&value)); Index idx(value, git_index_free); addEntries(value, entries);
  git_oid tree; check(git_index_write_tree_to(&tree, value, repo)); return createCommit(repo, tree, parents, message, nullptr);
}
Json checkoutInPrivateDirectory(git_repository *repo, git_index *idx) {
  auto parent = fs::path(git_repository_path(repo)) / "agent-mobile/plans"; fs::create_directories(parent);
  auto name = (parent / "merge-XXXXXX").string(); std::vector<char> buffer(name.begin(), name.end()); buffer.push_back('\0');
  char *created = ::mkdtemp(buffer.data()); if (!created) ioError("无法创建合并计划目录"); const fs::path directory(created);
  try {
    git_checkout_options options = GIT_CHECKOUT_OPTIONS_INIT;
    git_index *emptyValue = nullptr; check(git_index_new(&emptyValue)); Index empty(emptyValue, git_index_free);
    options.baseline_index = emptyValue;
    options.checkout_strategy = GIT_CHECKOUT_FORCE | GIT_CHECKOUT_ALLOW_CONFLICTS | GIT_CHECKOUT_DONT_UPDATE_INDEX | GIT_CHECKOUT_DONT_WRITE_INDEX | GIT_CHECKOUT_CONFLICT_STYLE_DIFF3;
    options.disable_filters = 1;
    options.target_directory = directory.c_str(); options.ancestor_label = "base"; options.our_label = "ours"; options.their_label = "theirs";
    check(git_checkout_index(repo, idx, &options));
    auto result = workingTree(repo, directory); Json attributes = result;
    for (const auto &conflict : conflictsOf(idx)) {
      const auto path = conflict.at("path").get<std::string>();
      if (fs::path(path).filename() != ".gitattributes") continue;
      if (conflict.at("ours").is_null()) attributes.erase(path);
      else attributes[path] = {{"revision", conflict.at("ours").at("oid")}, {"mode", conflict.at("ours").at("mode")}};
    }
    const auto current = head(repo);
    const auto frozen = commitEntries(repo, attributes, current.empty() ? std::vector<std::string>{} : std::vector<std::string>{current}, "Agent Mobile frozen merge attributes");
    result = filterEntries(repo, result, frozen, false);
    fs::remove_all(directory); return result;
  } catch (...) { fs::remove_all(directory); throw; }
}
bool isDescendant(git_repository *repo, const git_oid *commit, const git_oid *ancestor) {
  const int result = git_graph_descendant_of(repo, commit, ancestor);
  check(result); return result == 1;
}
Json rebasePlan(git_repository *repo, const Json &request) {
  requireClean(repo);
  const auto current = head(repo); require(!current.empty(), "空仓库没有可变基的提交");
  const std::string target = request.at("target"); auto onto = commitAt(repo, target), ours = commitAt(repo, current);
  Json result = {{"onto", target}, {"commits", Json::array()}};
  if (current == target || isDescendant(repo, git_commit_id(ours.get()), git_commit_id(onto.get()))) { result["kind"] = "up-to-date"; return result; }
  if (isDescendant(repo, git_commit_id(onto.get()), git_commit_id(ours.get()))) { result["kind"] = "fast-forward"; return result; }
  git_annotated_commit *branchValue = nullptr, *upstreamValue = nullptr;
  check(git_annotated_commit_lookup(&branchValue, repo, git_commit_id(ours.get()))); Ptr<git_annotated_commit, git_annotated_commit_free> branch(branchValue, git_annotated_commit_free);
  check(git_annotated_commit_lookup(&upstreamValue, repo, git_commit_id(onto.get()))); Ptr<git_annotated_commit, git_annotated_commit_free> upstream(upstreamValue, git_annotated_commit_free);
  git_rebase_options options = GIT_REBASE_OPTIONS_INIT; options.inmemory = 1; git_rebase *value = nullptr;
  check(git_rebase_init(&value, repo, branchValue, upstreamValue, upstreamValue, &options)); Ptr<git_rebase, git_rebase_free> rebase(value, git_rebase_free);
  const size_t count = git_rebase_operation_entrycount(value);
  if (count > 1000) throw Failure("LIMIT", "单次移动端变基最多重放 1,000 个提交，请缩小范围");
  for (size_t i = 0; i < count; ++i) {
    const auto *operation = git_rebase_operation_byindex(value, i); require(operation && operation->type == GIT_REBASE_OPERATION_PICK, "不支持此变基指令");
    auto commit = commitAt(repo, id(&operation->id)); const auto *author = git_commit_author(commit.get());
    if (std::strlen(git_commit_message_raw(commit.get())) > 65536) throw Failure("LIMIT", "原提交说明超过移动端变基状态预算");
    const unsigned parents = git_commit_parentcount(commit.get()); require(parents <= 1, "合并提交不能作为普通 pick 重放");
    result["commits"].push_back({{"oid", id(&operation->id)}, {"parent", parents ? Json(id(git_commit_parent_id(commit.get(), 0))) : Json()},
      {"message", git_commit_message_raw(commit.get())}, {"author", {{"name", author->name}, {"email", author->email}, {"time", author->when.time}, {"offset", author->when.offset}}}});
  }
  result["kind"] = "replay"; return result;
}
Json rebaseStep(git_repository *repo, const fs::path &root, const Json &request) {
  const std::string current = request.at("current"), original = request.at("commit");
  if (head(repo) != current || !branch(repo).is_null()) throw Failure("CONFLICT", "变基重放基线已变化");
  require(git_repository_state(repo) == GIT_REPOSITORY_STATE_REBASE_INTERACTIVE, "没有可重放的变基状态");
  const auto committed = treeMap(repo, current);
  require(indexMap(repo) == committed, "请先完成当前提交的冲突处理");
  auto commit = commitAt(repo, original), parent = commitAt(repo, current); require(git_commit_parentcount(commit.get()) <= 1, "不支持重放合并提交");
  git_index *value = nullptr; git_merge_options options = GIT_MERGE_OPTIONS_INIT;
  check(git_cherrypick_commit(&value, repo, commit.get(), parent.get(), 0, &options)); Index idx(value, git_index_free);
  const auto desired = checkoutInPrivateDirectory(repo, value), before = materializedTree(repo, current), working = workingTree(repo, root);
  std::set<std::string> paths; for (const auto &[path, entry] : before.items()) paths.insert(path); for (const auto &[path, entry] : desired.items()) paths.insert(path);
  Json candidates = Json::object();
  for (const auto &path : paths)
    if (before.value(path, Json()) != desired.value(path, Json()) && working.contains(path) && before.value(path, Json()) != working.at(path)) candidates[path] = working.at(path);
  // A clean worktree can use CRLF/ident bytes different from canonical smudge output.
  const auto cleaned = candidates.empty() ? candidates : filterEntries(repo, candidates, current, true);
  Json changes = Json::array();
  for (const auto &path : paths) {
    const auto expected = before.value(path, Json()), target = desired.value(path, Json()), actual = working.value(path, Json());
    if (expected == target) continue;
    require((expected.is_null() || expected.at("mode") != unsigned(GIT_FILEMODE_COMMIT)) && (target.is_null() || target.at("mode") != unsigned(GIT_FILEMODE_COMMIT)), "涉及子模块变化的变基尚未支持");
    if (actual != expected && cleaned.value(path, Json()) != committed.value(path, Json())) throw Failure("CONFLICT", "重放将覆盖用户编辑或未跟踪文件，请先处理：" + path);
    changes.push_back({{"path", path}, {"before", actual}, {"after", target}});
  }
  return {{"index", stateOfIndex(value)}, {"changes", changes}};
}
Json rebaseCommit(git_repository *repo, const Json &request) {
  const std::string original = request.at("original"), previous = request.at("parent");
  auto commit = commitAt(repo, original), parent = commitAt(repo, previous);
  require(git_commit_parentcount(commit.get()) <= 1, "不支持重放合并提交");
  git_index *indexValue = nullptr; check(git_index_new(&indexValue)); Index idx(indexValue, git_index_free);
  require(request.at("entries").is_object(), "提交条目必须是路径映射");
  for (const auto &[path, entry] : request.at("entries").items()) require(!entry.is_null(), "提交条目不能包含删除操作");
  addEntries(indexValue, request.at("entries")); git_oid treeId; check(git_index_write_tree_to(&treeId, indexValue, repo));
  bool initiallyEmpty = false;
  if (git_commit_parentcount(commit.get())) {
    auto oldParent = commitAt(repo, id(git_commit_parent_id(commit.get(), 0)));
    initiallyEmpty = git_oid_equal(git_commit_tree_id(commit.get()), git_commit_tree_id(oldParent.get()));
  } else { git_tree *treeValue = nullptr; check(git_commit_tree(&treeValue, commit.get())); Tree tree(treeValue, git_tree_free); initiallyEmpty = git_tree_entrycount(treeValue) == 0; }
  if (!initiallyEmpty && git_oid_equal(&treeId, git_commit_tree_id(parent.get()))) return nullptr;
  git_tree *treeValue = nullptr; check(git_tree_lookup(&treeValue, repo, &treeId)); Tree tree(treeValue, git_tree_free);
  git_signature *signatureValue = nullptr; const auto name = configValue(repo, "user.name"), email = configValue(repo, "user.email");
  require(!name.empty() && !email.empty(), "请先设置 Git 提交姓名和邮箱"); check(git_signature_now(&signatureValue, name.c_str(), email.c_str())); Sig committer(signatureValue, git_signature_free);
  git_oid oid; const git_commit *parents[] = {parent.get()};
  check(git_commit_create(&oid, repo, nullptr, git_commit_author(commit.get()), committer.get(), git_commit_message_encoding(commit.get()), git_commit_message_raw(commit.get()), treeValue, 1, parents));
  return id(&oid);
}
Json mergePlan(git_repository *repo, const fs::path &root, const Json &request) {
  requireClean(repo);
  const std::string target = request.at("target"), current = head(repo); auto theirs = commitAt(repo, target);
  Json state = gitState(repo); auto idx = index(repo);
  if (current == target || (!current.empty() && isDescendant(repo, git_commit_id(commitAt(repo, current).get()), git_commit_id(theirs.get()))))
    return {{"kind", "up-to-date"}, {"changes", Json::array()}, {"index", stateOfIndex(idx.get())}, {"stateAfter", state}};
  const auto before = treeMap(repo, current); Json afterIndex, desired; std::string kind, next, baseOid;
  if (current.empty() || isDescendant(repo, git_commit_id(theirs.get()), git_commit_id(commitAt(repo, current).get()))) {
    const auto plan = switchPlan(repo, root, target); afterIndex = {{"entries", plan.at("index")}, {"conflicts", Json::array()}}; desired = materializedTree(repo, target); kind = "fast-forward"; next = target;
  } else {
    auto ours = commitAt(repo, current); git_oid base;
    int result = git_merge_base(&base, repo, git_commit_id(ours.get()), git_commit_id(theirs.get()));
    if (result == GIT_ENOTFOUND) throw Failure("VALIDATION", "两个分支没有共同祖先，请确认仓库来源"); check(result);
    baseOid = id(&base);
    git_index *mergedValue = nullptr; git_merge_options options = GIT_MERGE_OPTIONS_INIT;
    check(git_merge_commits(&mergedValue, repo, ours.get(), theirs.get(), &options)); Index merged(mergedValue, git_index_free);
    afterIndex = stateOfIndex(mergedValue);
    desired = checkoutInPrivateDirectory(repo, mergedValue);
    if (git_index_has_conflicts(mergedValue)) {
      kind = "conflicts"; state["MERGE_HEAD"] = target + "\n"; state["MERGE_MSG"] = request.at("message"); state["MERGE_MODE"] = "";
    } else { kind = "merged"; next = commitEntries(repo, afterIndex.at("entries"), {current, target}, request.at("message")); }
  }
  state["ORIG_HEAD"] = current.empty() ? Json(nullptr) : Json(current + "\n");
  const auto working = workingTree(repo, root); std::set<std::string> paths;
  for (const auto &[path, entry] : before.items()) paths.insert(path);
  for (const auto &[path, entry] : desired.items()) paths.insert(path);
  Json changes = Json::array();
  for (const auto &path : paths) {
    const auto a = working.value(path, Json()), b = desired.value(path, Json());
    if (a == b) continue;
    require((a.is_null() || a.at("mode") != unsigned(GIT_FILEMODE_COMMIT)) && (b.is_null() || b.at("mode") != unsigned(GIT_FILEMODE_COMMIT)), "涉及子模块变化的合并尚未支持");
    if (!before.contains(path) && !a.is_null()) throw Failure("CONFLICT", "合并将覆盖未跟踪或忽略的文件");
    changes.push_back({{"path", path}, {"before", a}, {"after", b}});
  }
  Json output = {{"kind", kind}, {"changes", changes}, {"index", afterIndex}, {"stateAfter", state}};
  if (!baseOid.empty()) output["baseOid"] = baseOid;
  if (!next.empty()) output["headAfter"] = {{"branch", branch(repo)}, {"oid", next}};
  return output;
}

Json dispatch(const fs::path &root, const Json &request, am_git_callbacks callbacks) {
  const auto method = request.at("method").get<std::string>();
  validateRepositoryLayout(root);
  if (method == "clone" || method == "cloneState" || method == "publishClone" || method == "discardClone") return cloneOperation(root, request, callbacks);
  if (method == "recoverLocks") {
    if (callbacks.progress) callbacks.progress(callbacks.context, "recover-locks", 0, 1, 0);
    requireActive(callbacks); recoverLocks(root);
    if (callbacks.progress) callbacks.progress(callbacks.context, "recover-locks", 1, 1, 0);
    return nullptr;
  }
  if (method.rfind("file", 0) == 0) return fileOperation(root, request);
  if (method == "revision") { auto bytes = decode(request.at("bytes")); git_oid oid; check(git_odb_hash(&oid, bytes.data(), bytes.size(), GIT_OBJECT_BLOB)); return id(&oid); }
  if (method == "init") {
    fs::create_directories(root);
    git_repository_init_options options = GIT_REPOSITORY_INIT_OPTIONS_INIT;
    options.initial_head = "main"; options.flags = GIT_REPOSITORY_INIT_MKPATH | GIT_REPOSITORY_INIT_NO_REINIT;
    git_repository *value = nullptr; check(git_repository_init_ext(&value, root.c_str(), &options)); Repo repo(value, git_repository_free);
    // A local default keeps initial app-created content usable; user-editable in Git settings.
    auto cfg = config(repo.get()); check(git_config_set_string(cfg.get(), "user.name", "Agent Mobile"));
    check(git_config_set_string(cfg.get(), "user.email", "local@agentmobile.invalid")); return nullptr;
  }
  auto repo = open(root);
  if (request.contains("guard")) {
    const auto &guard = request.at("guard"); auto current = head(repo.get());
    Json oid = current.empty() ? Json(nullptr) : Json(current);
    if (guard.at("head") != oid || guard.at("branch") != branch(repo.get()))
      throw Failure("CONFLICT", "VERSION_CONFLICT：当前分支或提交已变化");
  }
  if (method == "head") { auto value = head(repo.get()); return value.empty() ? Json(nullptr) : Json(value); }
  if (method == "indexState") { auto idx = index(repo.get()); return stateOfIndex(idx.get()); }
  if (method == "setIndexState") {
    auto idx = index(repo.get()); const auto actual = conflictsOf(idx.get());
    if (actual != request.at("beforeConflicts") && actual != request.at("afterConflicts")) throw Failure("CONFLICT", "三方索引与恢复意图不匹配");
    check(git_index_conflict_cleanup(idx.get())); addEntries(idx.get(), request.at("entries")); addConflicts(idx.get(), request.at("afterConflicts")); check(git_index_write(idx.get())); return nullptr;
  }
  if (method == "gitState") return gitState(repo.get());
  if (method == "applyGitState") { applyGitState(repo.get(), request.at("before"), request.at("after")); return nullptr; }
  if (method == "filterEntries") return filterEntries(repo.get(), request.at("entries"), request.at("attributes"), request.at("direction") == "clean");
  if (method == "mergePlan") return mergePlan(repo.get(), root, request);
  if (method == "rebasePlan") return rebasePlan(repo.get(), request);
  if (method == "rebaseStep") return rebaseStep(repo.get(), root, request);
  if (method == "rebaseCommit") return rebaseCommit(repo.get(), request);
  if (method == "mergeCommit") {
    const auto parents = request.at("parents").get<std::vector<std::string>>();
    require(parents.size() == 2 && parents[0] != parents[1], "合并提交必须包含两个不同的父提交");
    return commitEntries(repo.get(), request.at("entries"), parents, request.at("message"));
  }
  if (method == "operationReceipt" || method == "completeOperation") {
    const auto operationId = request.at("operationId").get<std::string>(); git_oid key; check(git_odb_hash(&key, operationId.data(), operationId.size(), GIT_OBJECT_BLOB));
    const auto ref = "refs/agent-mobile/applied/" + id(&key); git_oid actual; int found = git_reference_name_to_id(&actual, repo.get(), ref.c_str());
    if (found != GIT_ENOTFOUND) check(found);
    if (method == "operationReceipt") return found == GIT_ENOTFOUND ? Json(nullptr) : Json(id(&actual));
    const std::string expected = request.at("checkpoint"); auto commit = commitAt(repo.get(), expected);
    if (found == 0) { require(id(&actual) == expected, "操作完成标记与意图不匹配"); return nullptr; }
    git_reference *created = nullptr; check(git_reference_create(&created, repo.get(), ref.c_str(), git_commit_id(commit.get()), 0, "Agent Mobile operation complete")); git_reference_free(created); return nullptr;
  }
  if (method == "branch") return branch(repo.get());
  if (method == "history") return history(repo.get(), request);
  if (method == "overview") return overview(repo.get());
  if (method == "status") return status(repo.get(), root, request);
  if (method == "switchPlan") return switchPlan(repo.get(), root, request.at("target"));
  if (method == "changeHead") { changeHead(repo.get(), request.at("before"), request.at("after"), request.value("branchGuard", Json())); return nullptr; }
  if (method == "uncommittedPaths") return uncommittedPaths(repo.get(), request);
  if (method == "workingTree") return workingTree(repo.get(), root, request.value("paths", Json()));
  if (method == "stageEntries") return stagedEntries(repo.get(), root, request.at("paths"));
  if (method == "applyWorktree") { applyWorktree(repo.get(), root, request); return nullptr; }
  if (method == "writeBlob") {
    auto bytes = decode(request.at("bytes")); git_oid oid;
    check(git_blob_create_frombuffer(&oid, repo.get(), bytes.data(), bytes.size()));
    auto verified = blobAt(repo.get(), id(&oid));
    git_oid actual; check(git_odb_hash(&actual, git_blob_rawcontent(verified.get()), git_blob_rawsize(verified.get()), GIT_OBJECT_BLOB));
    require(git_oid_equal(&oid, &actual), "Git 对象内容校验失败"); return id(&oid);
  }
  if (method == "blobInfo") {
    git_odb *databaseValue = nullptr; check(git_repository_odb(&databaseValue, repo.get())); Ptr<git_odb, git_odb_free> database(databaseValue, git_odb_free);
    auto oid = parseId(request.at("oid")); size_t size; git_object_t type;
    check(git_odb_read_header(&size, &type, database.get(), &oid)); require(type == GIT_OBJECT_BLOB, "对象不是文件"); return {{"size", size}};
  }
  if (method == "entries") return treeEntries(repo.get(), request.at("ref"));
  if (method == "indexEntries") return indexEntries(repo.get());
  if (method == "index") return indexMap(repo.get());
  if (method == "blob" || method == "readAt") {
    std::string oid;
    if (method == "blob") oid = request.at("oid");
    else {
      auto tree = treeAt(repo.get(), request.at("ref")); git_tree_entry *entry = nullptr;
      auto path = safePath(request.at("path")); check(git_tree_entry_bypath(&entry, tree.get(), path.c_str()));
      Ptr<git_tree_entry, git_tree_entry_free> guard(entry, git_tree_entry_free); oid = id(git_tree_entry_id(entry));
    }
    auto value = blobAt(repo.get(), oid); return base64(git_blob_rawcontent(value.get()), git_blob_rawsize(value.get()));
  }
  if (method == "tree") {
    return treeMap(repo.get(), request.at("ref"));
  }
  if (method == "setIndex") {
    auto idx = index(repo.get()); require(!git_index_has_conflicts(idx.get()), "请先解决合并冲突");
    for (const auto &[path, object] : request.at("entries").items()) {
      safePath(path);
      if (object.is_null()) { int result = git_index_remove_bypath(idx.get(), path.c_str()); if (result != GIT_ENOTFOUND) check(result); }
      else {
        git_index_entry entry{}; entry.path = path.c_str(); entry.id = parseId(object.at("revision")); entry.mode = object.at("mode");
        require(entry.mode == GIT_FILEMODE_BLOB || entry.mode == GIT_FILEMODE_BLOB_EXECUTABLE || entry.mode == GIT_FILEMODE_LINK || entry.mode == GIT_FILEMODE_COMMIT, "无效索引模式");
        check(git_index_add(idx.get(), &entry));
      }
    }
    check(git_index_write(idx.get())); return nullptr;
  }
  if (method == "checkpointRef" || method == "checkpoint") {
    auto ref = checkpointRef(request.at("key")); git_oid oid; int result = git_reference_name_to_id(&oid, repo.get(), ref.c_str());
    if (!result) return id(&oid);
    if (result != GIT_ENOTFOUND) check(result);
    if (method == "checkpointRef") return nullptr;
    return writeSnapshot(repo.get(), request.at("files"), ref, request.at("parent"));
  }
  if (method == "commit" || method == "commitSnapshot") {
    auto idx = index(repo.get());
    require(!git_index_has_conflicts(idx.get()), "请先解决合并冲突");
    git_oid treeId;
    auto previous = head(repo.get());
    if (method == "commitSnapshot") {
      if ((previous.empty() ? Json(nullptr) : Json(previous)) != request.at("expectedHead")) throw Failure("CONFLICT", "VERSION_CONFLICT：提交基线已变化");
      auto snapshot = commitAt(repo.get(), request.at("snapshot")); treeId = *git_commit_tree_id(snapshot.get());
    } else {
      for (const auto &pathValue : request.at("paths")) {
        auto path = safePath(pathValue); auto full = filePath(root, path); struct stat info;
        if (::lstat(full.c_str(), &info) == 0) check(git_index_add_bypath(idx.get(), path.c_str()));
        else { int result = git_index_remove_bypath(idx.get(), path.c_str()); if (result != GIT_ENOTFOUND) check(result); }
      }
      check(git_index_write(idx.get())); check(git_index_write_tree(&treeId, idx.get()));
    }
    return createCommit(repo.get(), treeId, {previous}, request.at("message"), "HEAD");
  }
  if (method == "findOperation") {
    Json query = request; query["query"] = {{"limit", 100}};
    for (;;) {
      auto page = history(repo.get(), query);
      for (const auto &version : page.at("versions")) {
        const auto message = version.at("message").get<std::string>();
        const auto trailer = "AgentMobile-Operation: " + request.at("operationId").get<std::string>();
        size_t start = 0;
        while (start < message.size()) { auto end = message.find('\n', start); auto line = message.substr(start, end == std::string::npos ? end : end - start); if (!line.empty() && line.back() == '\r') line.pop_back(); if (line == trailer) return version.at("oid"); if (end == std::string::npos) break; start = end + 1; }
      }
      if (!page.contains("cursor")) return nullptr;
      query["query"]["cursor"] = page.at("cursor");
    }
  }
  if (method == "identity") {
    auto name = request.at("name").get<std::string>(), email = request.at("email").get<std::string>();
    require(!name.empty() && !email.empty() && name.find('\n') == std::string::npos && email.find('\n') == std::string::npos, "提交身份无效");
    auto cfg = config(repo.get()); check(git_config_set_string(cfg.get(), "user.name", name.c_str())); check(git_config_set_string(cfg.get(), "user.email", email.c_str())); return nullptr;
  }
  if (method == "branchCreate") {
    auto current = commitAt(repo.get(), request.value("ref", head(repo.get()))); git_reference *value = nullptr;
    auto name = request.at("name").get<std::string>(); check(git_branch_create(&value, repo.get(), name.c_str(), current.get(), 0)); git_reference_free(value); return nullptr;
  }
  if (method == "branchDelete") {
    auto name = request.at("name").get<std::string>(); git_reference *value = nullptr;
    check(git_branch_lookup(&value, repo.get(), name.c_str(), GIT_BRANCH_LOCAL)); Ref ref(value, git_reference_free);
    require(git_branch_is_head(value) == 0, "不能删除当前分支");
    auto current = parseId(head(repo.get())); const auto *target = git_reference_target(value);
    require(git_oid_equal(&current, target) || isDescendant(repo.get(), &current, target), "分支尚未合入当前分支");
    check(git_branch_delete(value)); return nullptr;
  }
  if (method == "tagCreate" || method == "tagDelete") {
    auto name = request.at("name").get<std::string>();
    if (method == "tagDelete") check(git_tag_delete(repo.get(), name.c_str()));
    else { auto current = commitAt(repo.get(), head(repo.get())); git_oid oid;
      check(git_tag_create_lightweight(&oid, repo.get(), name.c_str(), reinterpret_cast<git_object *>(current.get()), 0)); }
    return nullptr;
  }
  if (method == "remoteSave") {
    auto name = request.at("name").get<std::string>(), url = request.at("url").get<std::string>();
    httpsOrigin(url);
    git_remote *value = nullptr; int result = git_remote_lookup(&value, repo.get(), name.c_str());
    if (!result) { git_remote_free(value); check(git_remote_set_url(repo.get(), name.c_str(), url.c_str())); }
    else if (result == GIT_ENOTFOUND) { check(git_remote_create(&value, repo.get(), name.c_str(), url.c_str())); git_remote_free(value); }
    else check(result); return nullptr;
  }
  if (method == "upstream") {
    const auto name = request.at("name").get<std::string>(); git_reference *value = nullptr;
    check(git_branch_lookup(&value, repo.get(), name.c_str(), GIT_BRANCH_LOCAL)); Ref ref(value, git_reference_free);
    const auto upstream = request.at("upstream");
    if (upstream.is_null()) check(git_branch_set_upstream(ref.get(), nullptr));
    else check(git_branch_set_upstream(ref.get(), upstream.get<std::string>().c_str())); return nullptr;
  }
  if (method == "fetch" || method == "remoteHead" || method == "push") {
    auto name = request.at("name").get<std::string>(); git_remote *value = nullptr;
    check(git_remote_lookup(&value, repo.get(), name.c_str())); Remote remote(value, git_remote_free);
    auto transfer = transferContext(value, request, callbacks); requireActive(callbacks);
    if (method == "fetch") {
      git_fetch_options options = GIT_FETCH_OPTIONS_INIT; options.callbacks = remoteCallbacks(&transfer); options.follow_redirects = GIT_REMOTE_REDIRECT_NONE;
      checkTransfer(git_remote_fetch(value, nullptr, &options, nullptr), transfer); return nullptr;
    }
    const auto nameOfBranch = request.at("branch").get<std::string>(); const auto ref = "refs/heads/" + nameOfBranch;
    int valid = 0; check(git_reference_name_is_valid(&valid, ref.c_str())); require(valid, "目标分支名称无效");
    if (method == "remoteHead") {
      git_remote_connect_options options = GIT_REMOTE_CONNECT_OPTIONS_INIT; options.callbacks = remoteCallbacks(&transfer); options.follow_redirects = GIT_REMOTE_REDIRECT_NONE;
      checkTransfer(git_remote_connect_ext(value, GIT_DIRECTION_PUSH, &options), transfer);
      const git_remote_head **heads = nullptr; size_t count = 0; checkTransfer(git_remote_ls(&heads, &count, value), transfer);
      Json found;
      for (size_t i = 0; i < count; ++i) if (ref == heads[i]->name) found = id(&heads[i]->oid);
      check(git_remote_disconnect(value)); return found;
    }
    require(request.contains("guard") && request.at("guard").contains("remoteHead"), "推送缺少远程版本基线");
    const auto current = head(repo.get()); require(!current.empty(), "没有可以推送的提交");
    transfer.wanted = current; transfer.destination = ref;
    const auto expected = request.at("guard").at("remoteHead"); transfer.expected = expected.is_null() ? std::string() : expected.get<std::string>();
    const auto spec = current + ":" + ref; char *rawSpec = const_cast<char *>(spec.c_str()); git_strarray refspecs{&rawSpec, 1};
    git_push_options options = GIT_PUSH_OPTIONS_INIT; options.callbacks = remoteCallbacks(&transfer); options.follow_redirects = GIT_REMOTE_REDIRECT_NONE;
    checkTransfer(git_remote_push(value, &refspecs, &options), transfer, true); return nullptr;
  }
  throw Failure("VALIDATION", "Unsupported native Git operation");
}
} // namespace

extern "C" char *am_git_execute(const char *root, const char *request, am_git_callbacks callbacks) {
  Json result;
  try {
    am_git_version();
    const auto input = Json::parse(request);
    RepositoryLease lease(fs::path(root), callbacks);
    result = {{"ok", true}, {"value", dispatch(root, input, callbacks)}};
  }
  catch (const Failure &failure) {
    std::string message = failure.what(), nativePath = root;
    if (!nativePath.empty()) {
      size_t position;
      while ((position = message.find(nativePath)) != std::string::npos) message.replace(position, nativePath.size(), "<repository>");
    }
    result = {{"ok", false}, {"code", failure.code}, {"message", message}, {"uncertain", failure.uncertain}};
  }
  catch (const std::exception &) { result = {{"ok", false}, {"code", "STORAGE"}, {"message", "原生 Git 请求或仓库状态无效"}}; }
  return ::strdup(result.dump().c_str());
}
