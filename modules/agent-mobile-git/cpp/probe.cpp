#include "probe.h"
#include <git2.h>
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#include <sys/stat.h>
#include <unistd.h>

namespace {
namespace fs = std::filesystem;
using Clock = std::chrono::steady_clock;
template <typename T, void (*Free)(T *)> using Ptr = std::unique_ptr<T, decltype(Free)>;
using Repo = Ptr<git_repository, git_repository_free>;
using Index = Ptr<git_index, git_index_free>;
using Tree = Ptr<git_tree, git_tree_free>;
using Commit = Ptr<git_commit, git_commit_free>;
using Object = Ptr<git_object, git_object_free>;
using Blob = Ptr<git_blob, git_blob_free>;
using Signature = Ptr<git_signature, git_signature_free>;
using Reference = Ptr<git_reference, git_reference_free>;
using Remote = Ptr<git_remote, git_remote_free>;

void ensure(bool condition, const std::string &message) {
  if (!condition) throw std::runtime_error(message);
}
void checked(int code) {
  if (code >= 0) return;
  const git_error *error = git_error_last();
  throw std::runtime_error("libgit2 " + std::to_string(code) + ": " +
                           (error ? error->message : "operation failed"));
}
std::string oid(const git_oid *id) {
  char output[GIT_OID_HEXSZ + 1];
  git_oid_tostr(output, sizeof(output), id);
  return output;
}
std::string jsonString(const std::string &value) {
  std::ostringstream result;
  result << '"';
  for (unsigned char c : value) {
    if (c == '"' || c == '\\') result << '\\' << c;
    else if (c == '\n') result << "\\n";
    else if (c == '\r') result << "\\r";
    else if (c == '\t') result << "\\t";
    else if (c < 32) {
      const char *digits = "0123456789abcdef";
      result << "\\u00" << digits[c >> 4] << digits[c & 15];
    } else result << c;
  }
  result << '"';
  return result.str();
}
void write(const fs::path &path, const std::string &bytes) {
  fs::create_directories(path.parent_path());
  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  output.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
  output.close();
  ensure(output.good(), "Cannot write fixture");
}
std::string read(const fs::path &path) {
  std::ifstream input(path, std::ios::binary);
  ensure(input.good(), "Cannot read fixture");
  return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}
Repo open(const fs::path &path) {
  git_repository *value = nullptr;
  checked(git_repository_open(&value, path.c_str()));
  return Repo(value, git_repository_free);
}
Repo init(const fs::path &path, bool bare = false) {
  ensure(!fs::exists(path), "Probe repository already exists; choose a new runId");
  git_repository_init_options options = GIT_REPOSITORY_INIT_OPTIONS_INIT;
  options.flags = GIT_REPOSITORY_INIT_MKPATH | (bare ? GIT_REPOSITORY_INIT_BARE : 0);
  options.initial_head = "main";
  git_repository *value = nullptr;
  checked(git_repository_init_ext(&value, path.c_str(), &options));
  return Repo(value, git_repository_free);
}
Index index(git_repository *repo) {
  git_index *value = nullptr;
  checked(git_repository_index(&value, repo));
  return Index(value, git_index_free);
}
Commit head(git_repository *repo) {
  git_oid id;
  checked(git_reference_name_to_id(&id, repo, "HEAD"));
  git_commit *value = nullptr;
  checked(git_commit_lookup(&value, repo, &id));
  return Commit(value, git_commit_free);
}
void stage(git_repository *repo, const char *path) {
  auto value = index(repo);
  checked(git_index_add_bypath(value.get(), path));
  checked(git_index_write(value.get()));
}
std::string blob(git_repository *repo, const git_oid *id) {
  git_blob *value = nullptr;
  checked(git_blob_lookup(&value, repo, id));
  Blob guard(value, git_blob_free);
  return {static_cast<const char *>(git_blob_rawcontent(value)),
          static_cast<size_t>(git_blob_rawsize(value))};
}
std::string commit(git_repository *repo, const char *message) {
  auto idx = index(repo);
  ensure(!git_index_has_conflicts(idx.get()), "Cannot commit unresolved conflicts");
  git_oid treeId;
  checked(git_index_write_tree(&treeId, idx.get()));
  git_tree *treeValue = nullptr;
  checked(git_tree_lookup(&treeValue, repo, &treeId));
  Tree tree(treeValue, git_tree_free);
  git_signature *signatureValue = nullptr;
  checked(git_signature_now(&signatureValue, "Git Validation", "validation@example.invalid"));
  Signature signature(signatureValue, git_signature_free);
  std::vector<Commit> parents;
  if (!git_repository_head_unborn(repo)) parents.push_back(head(repo));
  std::vector<git_oid> mergeHeads;
  if (git_repository_state(repo) == GIT_REPOSITORY_STATE_MERGE) {
    checked(git_repository_mergehead_foreach(repo, [](const git_oid *id, void *data) {
      static_cast<std::vector<git_oid> *>(data)->push_back(*id);
      return 0;
    }, &mergeHeads));
  }
  for (const auto &id : mergeHeads) {
    git_commit *value = nullptr;
    checked(git_commit_lookup(&value, repo, &id));
    parents.emplace_back(value, git_commit_free);
  }
  std::vector<const git_commit *> pointers;
  for (const auto &parent : parents) pointers.push_back(parent.get());
  git_oid id;
  checked(git_commit_create(&id, repo, "HEAD", signature.get(), signature.get(), nullptr,
                            message, tree.get(), pointers.size(), pointers.data()));
  checked(git_repository_state_cleanup(repo));
  return oid(&id);
}
void branch(git_repository *repo, const char *name) {
  auto current = head(repo);
  git_reference *value = nullptr;
  checked(git_branch_create(&value, repo, name, current.get(), 0));
  git_reference_free(value);
}
void checkout(git_repository *repo, const char *name) {
  const std::string ref = "refs/heads/" + std::string(name);
  git_object *value = nullptr;
  checked(git_revparse_single(&value, repo, ref.c_str()));
  Object target(value, git_object_free);
  git_checkout_options options = GIT_CHECKOUT_OPTIONS_INIT;
  options.checkout_strategy = GIT_CHECKOUT_SAFE;
  checked(git_checkout_tree(repo, target.get(), &options));
  checked(git_repository_set_head(repo, ref.c_str()));
}
void merge(git_repository *repo, const char *name) {
  git_reference *refValue = nullptr;
  checked(git_branch_lookup(&refValue, repo, name, GIT_BRANCH_LOCAL));
  Reference reference(refValue, git_reference_free);
  git_annotated_commit *annotated = nullptr;
  checked(git_annotated_commit_from_ref(&annotated, repo, reference.get()));
  Ptr<git_annotated_commit, git_annotated_commit_free> target(annotated, git_annotated_commit_free);
  const git_annotated_commit *targets[] = {target.get()};
  git_checkout_options options = GIT_CHECKOUT_OPTIONS_INIT;
  options.checkout_strategy = GIT_CHECKOUT_SAFE | GIT_CHECKOUT_ALLOW_CONFLICTS;
  checked(git_merge(repo, targets, 1, nullptr, &options));
}
void conflictFixture(const fs::path &path) {
  auto repo = init(path);
  write(path / "note.md", "base\n");
  stage(repo.get(), "note.md");
  commit(repo.get(), "base");
  branch(repo.get(), "feature");
  checkout(repo.get(), "feature");
  write(path / "note.md", "theirs\n");
  stage(repo.get(), "note.md");
  commit(repo.get(), "feature");
  checkout(repo.get(), "main");
  write(path / "note.md", "ours\n");
  stage(repo.get(), "note.md");
  commit(repo.get(), "main");
  merge(repo.get(), "feature");
}
void verifyConflict(git_repository *repo) {
  auto idx = index(repo);
  ensure(git_repository_state(repo) == GIT_REPOSITORY_STATE_MERGE, "Merge state lost");
  ensure(git_index_has_conflicts(idx.get()), "Conflict index lost");
  const git_index_entry *base, *ours, *theirs;
  checked(git_index_conflict_get(&base, &ours, &theirs, idx.get(), "note.md"));
  ensure(base && ours && theirs, "Conflict stages missing");
  ensure(blob(repo, &base->id) == "base\n" && blob(repo, &ours->id) == "ours\n" &&
           blob(repo, &theirs->id) == "theirs\n", "Conflict stage content changed");
}

struct Probe {
  am_git_callbacks callbacks;
  std::vector<std::string> checks;
  void progress(const char *phase, unsigned completed = 0, unsigned total = 0,
                unsigned long long bytes = 0) {
    if (callbacks.progress) callbacks.progress(callbacks.context, phase, completed, total, bytes);
  }
  bool cancelled() { return callbacks.cancelled && callbacks.cancelled(callbacks.context); }
  void check(const char *name, const std::function<std::string()> &action) {
    ensure(!cancelled(), "CANCELLED");
    progress(name);
    const auto start = Clock::now();
    const auto detail = action();
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - start).count();
    checks.push_back("{\"name\":" + jsonString(name) + ",\"detail\":" + jsonString(detail) +
                     ",\"durationMs\":" + std::to_string(ms) + "}");
  }
  git_fetch_options fetchOptions() {
    git_fetch_options options = GIT_FETCH_OPTIONS_INIT;
    options.callbacks.payload = this;
    options.callbacks.transfer_progress = [](const git_indexer_progress *p, void *data) {
      auto &probe = *static_cast<Probe *>(data);
      probe.progress("transfer", p->received_objects, p->total_objects, p->received_bytes);
      return probe.cancelled() ? GIT_EUSER : 0;
    };
    options.callbacks.sideband_progress = [](const char *, int, void *data) {
      return static_cast<Probe *>(data)->cancelled() ? GIT_EUSER : 0;
    };
    // No credentials and no certificate bypass: public HTTPS and local fixtures only.
    return options;
  }
  Repo clone(const fs::path &path, const std::string &url) {
    ensure(!fs::exists(path), "Clone destination already exists");
    git_clone_options options = GIT_CLONE_OPTIONS_INIT;
    options.fetch_opts = fetchOptions();
    options.local = GIT_CLONE_NO_LOCAL;
    options.checkout_opts.progress_payload = this;
    options.checkout_opts.progress_cb = [](const char *, size_t done, size_t total, void *data) {
      static_cast<Probe *>(data)->progress("checkout", static_cast<unsigned>(done), static_cast<unsigned>(total));
    };
    options.checkout_opts.notify_flags = GIT_CHECKOUT_NOTIFY_ALL;
    options.checkout_opts.notify_payload = this;
    options.checkout_opts.notify_cb = [](git_checkout_notify_t, const char *, const git_diff_file *,
                                         const git_diff_file *, const git_diff_file *, void *data) {
      return static_cast<Probe *>(data)->cancelled() ? GIT_EUSER : 0;
    };
    git_repository *value = nullptr;
    int result = git_clone(&value, url.c_str(), path.c_str(), &options);
    Repo repo(value, git_repository_free);
    if (cancelled()) throw std::runtime_error("CANCELLED");
    checked(result);
    return repo;
  }
};

void local(Probe &probe, const fs::path &root) {
  const auto path = root / "repository";
  Repo repo(nullptr, git_repository_free);
  probe.check("init-unborn-head", [&] {
    repo = init(path);
    ensure(git_repository_head_unborn(repo.get()) == 1, "Expected unborn HEAD");
    write(path / ".gitignore", "ignored/\n");
    write(path / "ignored/cache.txt", "excluded\n");
    write(path / "note.md", "original\n");
    write(path / fs::u8path(u8"文档/你好😀.txt"), u8"UTF-8 内容\n");
    write(path / "run.sh", "#!/bin/sh\nexit 0\n");
    ensure(::chmod((path / "run.sh").c_str(), 0755) == 0, "chmod failed");
    ensure(::symlink("note.md", (path / "note-link").c_str()) == 0, "symlink failed");
    auto idx = index(repo.get());
    git_strarray paths = {nullptr, 0};
    checked(git_index_add_all(idx.get(), &paths, GIT_INDEX_ADD_DEFAULT, nullptr, nullptr));
    checked(git_index_write(idx.get()));
    ensure(!git_index_get_bypath(idx.get(), "ignored/cache.txt", 0), "gitignore not respected");
    return commit(repo.get(), "Initial validation commit");
  });
  probe.check("file-modes-and-unicode", [&] {
    auto current = head(repo.get());
    git_tree *treeValue = nullptr;
    checked(git_commit_tree(&treeValue, current.get()));
    Tree tree(treeValue, git_tree_free);
    const auto *executable = git_tree_entry_byname(tree.get(), "run.sh");
    const auto *link = git_tree_entry_byname(tree.get(), "note-link");
    ensure(executable && git_tree_entry_filemode(executable) == GIT_FILEMODE_BLOB_EXECUTABLE,
           "Executable bit lost");
    ensure(link && git_tree_entry_filemode(link) == GIT_FILEMODE_LINK, "Symlink mode lost");
    ensure(blob(repo.get(), git_tree_entry_id(link)) == "note.md", "Symlink target changed");
    ensure(read(path / fs::u8path(u8"文档/你好😀.txt")) == u8"UTF-8 内容\n", "Unicode content changed");
    return std::string("100755 executable, 120000 symlink, Unicode path and .gitignore preserved");
  });
  probe.check("head-index-worktree", [&] {
    write(path / "note.md", "staged\n");
    stage(repo.get(), "note.md");
    write(path / "note.md", "unstaged\n");
    auto idx = index(repo.get());
    const auto *entry = git_index_get_bypath(idx.get(), "note.md", 0);
    ensure(entry && blob(repo.get(), &entry->id) == "staged\n", "Index changed with worktree");
    unsigned status = 0;
    checked(git_status_file(&status, repo.get(), "note.md"));
    ensure((status & GIT_STATUS_INDEX_MODIFIED) && (status & GIT_STATUS_WT_MODIFIED),
           "Staged and unstaged status missing");
    stage(repo.get(), "note.md");
    return commit(repo.get(), "Update note");
  });
  probe.check("branch-and-safe-checkout", [&] {
    branch(repo.get(), "feature");
    checkout(repo.get(), "feature");
    write(path / "note.md", "feature\n");
    ensure(::chmod((path / "run.sh").c_str(), 0644) == 0, "Mode-only change failed");
    stage(repo.get(), "note.md");
    stage(repo.get(), "run.sh");
    commit(repo.get(), "Feature change");
    checkout(repo.get(), "main");
    struct stat executable;
    ensure(::stat((path / "run.sh").c_str(), &executable) == 0 && (executable.st_mode & S_IXUSR),
           "Checkout did not restore executable mode");
    write(path / "note.md", "unsaved local change\n");
    bool refused = false;
    try { checkout(repo.get(), "feature"); } catch (const std::exception &) { refused = true; }
    ensure(refused && read(path / "note.md") == "unsaved local change\n", "Dirty checkout overwrote work");
    write(path / "note.md", "unstaged\n");
    return std::string("Branch switch works; conflicting local edits block checkout");
  });
  probe.check("merge-conflict-stages", [&] {
    conflictFixture(root / "conflict");
    auto conflict = open(root / "conflict");
    verifyConflict(conflict.get());
    return std::string("Index stages 1/2/3 contain base/ours/theirs");
  });
  probe.check("resolve-two-parent-commit", [&] {
    auto conflict = open(root / "conflict");
    write(root / "conflict/note.md", "resolved\n");
    stage(conflict.get(), "note.md");
    auto id = commit(conflict.get(), "Resolve merge");
    auto current = head(conflict.get());
    ensure(git_commit_parentcount(current.get()) == 2, "Merge commit is not two-parent");
    ensure(git_repository_state(conflict.get()) == GIT_REPOSITORY_STATE_NONE, "Merge state not cleaned");
    return id;
  });
  probe.check("abort-merge-fixture", [&] {
    conflictFixture(root / "abort");
    auto conflict = open(root / "abort");
    auto current = head(conflict.get());
    git_checkout_options options = GIT_CHECKOUT_OPTIONS_INIT;
    // Isolated, originally clean fixture only; this is not a production abort policy.
    checked(git_reset(conflict.get(), reinterpret_cast<git_object *>(current.get()), GIT_RESET_HARD, &options));
    checked(git_repository_state_cleanup(conflict.get()));
    auto idx = index(conflict.get());
    ensure(!git_index_has_conflicts(idx.get()) && read(root / "abort/note.md") == "ours\n", "Abort failed");
    return std::string("Clean fixture restored; dirty pre-merge recovery remains application work");
  });
  probe.check("large-native-blob", [&] {
    const auto file = path / "large.bin";
    std::ofstream output(file, std::ios::binary);
    const std::string chunk(64 * 1024, '\0');
    for (int i = 0; i < 384; ++i) output.write(chunk.data(), chunk.size());
    output.close();
    ensure(output.good(), "Large fixture write failed");
    stage(repo.get(), "large.bin");
    auto id = commit(repo.get(), "Add 24 MiB binary");
    auto idx = index(repo.get());
    const auto *entry = git_index_get_bypath(idx.get(), "large.bin", 0);
    git_blob *value = nullptr;
    ensure(entry, "Large blob missing from index");
    checked(git_blob_lookup(&value, repo.get(), &entry->id));
    Blob guard(value, git_blob_free);
    ensure(git_blob_rawsize(value) == 24 * 1024 * 1024, "Large blob size changed");
    return std::string("24 MiB binary staged and committed without JS byte transfer; ") + id;
  });
  probe.check("local-clone-fetch-push", [&] {
    auto bare = init(root / "remote.git", true);
    git_remote *remoteValue = nullptr;
    const auto remotePath = (root / "remote.git").string();
    checked(git_remote_create(&remoteValue, repo.get(), "origin", remotePath.c_str()));
    Remote remote(remoteValue, git_remote_free);
    char refspec[] = "refs/heads/main:refs/heads/main";
    char *specs[] = {refspec};
    git_strarray refs = {specs, 1};
    checked(git_remote_push(remote.get(), &refs, nullptr));
    auto cloned = probe.clone(root / "clone", remotePath);
    ensure(git_oid_equal(git_commit_id(head(cloned.get()).get()), git_commit_id(head(repo.get()).get())), "Clone HEAD differs");
    write(path / "new.txt", "fetch this\n");
    stage(repo.get(), "new.txt");
    const auto expected = commit(repo.get(), "Second push");
    checked(git_remote_push(remote.get(), &refs, nullptr));
    git_remote *fetchValue = nullptr;
    checked(git_remote_lookup(&fetchValue, cloned.get(), "origin"));
    Remote fetched(fetchValue, git_remote_free);
    auto options = probe.fetchOptions();
    checked(git_remote_fetch(fetched.get(), nullptr, &options, nullptr));
    git_oid fetchedId;
    checked(git_reference_name_to_id(&fetchedId, cloned.get(), "refs/remotes/origin/main"));
    ensure(oid(&fetchedId) == expected, "Fetched ref not updated");
    return expected;
  });
}

void run(Probe &probe, const fs::path &root, const std::string &phase, const std::string &url) {
  if (phase == "local") local(probe, root);
  else if (phase == "prepare-restart") {
    probe.check("persist-conflict-before-process-exit", [&] {
      conflictFixture(root / "restart");
      auto repo = open(root / "restart");
      verifyConflict(repo.get());
      write(root / "restart-head", oid(git_commit_id(head(repo.get()).get())));
      return std::string("Conflicted index and MERGE_HEAD written to disk");
    });
  } else if (phase == "resume-restart") {
    probe.check("resume-conflict-after-process-restart", [&] {
      auto repo = open(root / "restart");
      verifyConflict(repo.get());
      ensure(oid(git_commit_id(head(repo.get()).get())) == read(root / "restart-head"), "HEAD changed across restart");
      write(root / "restart/note.md", "resolved after restart\n");
      stage(repo.get(), "note.md");
      auto id = commit(repo.get(), "Resolve after process restart");
      ensure(git_commit_parentcount(head(repo.get()).get()) == 2, "Restart lost merge parent");
      return id;
    });
  } else if (phase == "https") {
    ensure(url.rfind("https://", 0) == 0, "Only public HTTPS clone is allowed in this probe");
    probe.check("https-clone", [&] {
      auto repo = probe.clone(root / "https-clone", url);
      return oid(git_commit_id(head(repo.get()).get()));
    });
    probe.check("https-fetch", [&] {
      auto repo = open(root / "https-clone");
      git_remote *value = nullptr;
      checked(git_remote_lookup(&value, repo.get(), "origin"));
      Remote remote(value, git_remote_free);
      auto options = probe.fetchOptions();
      checked(git_remote_fetch(remote.get(), nullptr, &options, nullptr));
      return std::string("System TLS verified remote; fetch completed");
    });
  } else if (phase == "cancel") {
    ensure(url.rfind("https://", 0) == 0, "Only public HTTPS clone is allowed in this probe");
    probe.check("cancel-clone-staging", [&] {
      bool stopped = false;
      const auto destination = root / "cancel-staging";
      try { auto repo = probe.clone(destination, url); }
      catch (const std::exception &) { stopped = probe.cancelled(); }
      ensure(stopped, "Clone was not cancelled");
      // Only the freshly created, isolated staging directory is disposable.
      fs::remove_all(destination);
      ensure(!fs::exists(destination), "Cancelled staging directory remains");
      return std::string("Cancellation observed; unpublished staging removed");
    });
  } else throw std::runtime_error("Unknown probe phase");
}
} // namespace

extern "C" const char *am_git_version() {
  static std::once_flag initialized;
  std::call_once(initialized, [] {
    checked(git_libgit2_init());
    checked(git_libgit2_opts(GIT_OPT_ENABLE_STRICT_HASH_VERIFICATION, 1));
    checked(git_libgit2_opts(GIT_OPT_ENABLE_FSYNC_GITDIR, 1));
  });
  return LIBGIT2_VERSION;
}
extern "C" char *am_git_probe(const char *root, const char *phase, const char *remote,
                               am_git_callbacks callbacks) {
  Probe probe{callbacks, {}};
  std::string error;
  try {
    am_git_version();
    fs::create_directories(root);
    run(probe, root, phase, remote);
  } catch (const std::exception &failure) { error = failure.what(); }
  std::string output = "{\"ok\":" + std::string(error.empty() ? "true" : "false") +
    ",\"version\":" + jsonString(LIBGIT2_VERSION) + ",\"phase\":" + jsonString(phase) + ",\"checks\":[";
  for (size_t i = 0; i < probe.checks.size(); ++i) output += (i ? "," : "") + probe.checks[i];
  output += "]";
  if (!error.empty()) output += ",\"error\":" + jsonString(error);
  output += "}";
  return ::strdup(output.c_str());
}
extern "C" void am_git_free(char *value) { std::free(value); }
