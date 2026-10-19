#include "probe.h"
#include "repository.h"
#include <git2.h>
#include <git2/sys/errors.h>
#include <git2/sys/stream.h>
#include <jni.h>
#include <algorithm>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace {
struct Job { JavaVM *vm; jobject callback; jmethodID progress, cancelled, tls; };
thread_local Job *activeJob = nullptr;

// libgit2 may invoke transfer callbacks on its own pack worker threads.
// JNIEnv and JNI local references must never be shared with those threads.
struct AttachedEnv {
  JavaVM *vm;
  JNIEnv *env = nullptr;
  bool attached = false;
  explicit AttachedEnv(JavaVM *value) : vm(value) {
    if (vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) == JNI_EDETACHED)
      attached = vm->AttachCurrentThread(&env, nullptr) == JNI_OK;
  }
  ~AttachedEnv() { if (attached) vm->DetachCurrentThread(); }
};

bool exception(JNIEnv *env) {
  if (!env->ExceptionCheck()) return false;
  auto failure = env->ExceptionOccurred();
  env->ExceptionClear();
  auto type = env->GetObjectClass(failure);
  auto classType = env->FindClass("java/lang/Class");
  auto method = env->GetMethodID(classType, "getName", "()Ljava/lang/String;");
  auto name = static_cast<jstring>(env->CallObjectMethod(type, method));
  const char *chars = env->GetStringUTFChars(name, nullptr);
  std::string category(chars);
  env->ReleaseStringUTFChars(name, chars);
  env->DeleteLocalRef(name);
  env->DeleteLocalRef(type);
  env->DeleteLocalRef(classType);
  env->DeleteLocalRef(failure);
  // No host, URL, or credential material is copied into an error or log.
  const auto message = "Android TLS failed: " + category + " (system trust and hostname checks enabled)";
  git_error_set_str(GIT_ERROR_SSL, message.c_str());
  return true;
}
void progress(void *context, const char *phase, unsigned done, unsigned total, unsigned long long bytes) {
  auto &job = *static_cast<Job *>(context);
  AttachedEnv attached(job.vm);
  auto env = attached.env;
  if (!env) return;
  auto name = env->NewStringUTF(phase);
  env->CallVoidMethod(job.callback, job.progress, name, static_cast<jint>(done), static_cast<jint>(total), static_cast<jlong>(bytes));
  env->DeleteLocalRef(name);
  exception(env);
}
int cancelled(void *context) {
  auto &job = *static_cast<Job *>(context);
  AttachedEnv attached(job.vm);
  if (!attached.env) return 1;
  auto result = attached.env->CallBooleanMethod(job.callback, job.cancelled);
  return exception(attached.env) || result;
}
struct TlsStream {
  git_stream stream{};
  Job *job;
  jobject connection;
  jmethodID connect, read, write, close, certificate;
  std::vector<unsigned char> der;
  git_cert_x509 cert{};
};
int tlsConnect(git_stream *base) {
  auto &s = *reinterpret_cast<TlsStream *>(base);
  AttachedEnv attached(s.job->vm);
  if (!attached.env) return -1;
  attached.env->CallVoidMethod(s.connection, s.connect);
  return exception(attached.env) ? -1 : 0;
}
int tlsCertificate(git_cert **output, git_stream *base) {
  auto &s = *reinterpret_cast<TlsStream *>(base);
  AttachedEnv attached(s.job->vm);
  auto env = attached.env;
  if (!env) return -1;
  auto bytes = static_cast<jbyteArray>(env->CallObjectMethod(s.connection, s.certificate));
  if (exception(env) || !bytes) return -1;
  s.der.resize(env->GetArrayLength(bytes));
  env->GetByteArrayRegion(bytes, 0, s.der.size(), reinterpret_cast<jbyte *>(s.der.data()));
  env->DeleteLocalRef(bytes);
  s.cert.parent.cert_type = GIT_CERT_X509;
  s.cert.data = s.der.data();
  s.cert.len = s.der.size();
  *output = reinterpret_cast<git_cert *>(&s.cert);
  return 0;
}
ssize_t tlsRead(git_stream *base, void *output, size_t length) {
  auto &s = *reinterpret_cast<TlsStream *>(base);
  AttachedEnv attached(s.job->vm);
  auto env = attached.env;
  if (!env) return -1;
  if (cancelled(s.job)) return GIT_EUSER;
  auto bytes = static_cast<jbyteArray>(env->CallObjectMethod(s.connection, s.read, static_cast<jint>(std::min(length, size_t(65536)))));
  if (exception(env) || !bytes) return -1;
  auto count = env->GetArrayLength(bytes);
  env->GetByteArrayRegion(bytes, 0, count, static_cast<jbyte *>(output));
  env->DeleteLocalRef(bytes);
  return exception(env) ? -1 : count;
}
ssize_t tlsWrite(git_stream *base, const char *input, size_t length, int) {
  auto &s = *reinterpret_cast<TlsStream *>(base);
  AttachedEnv attached(s.job->vm);
  auto env = attached.env;
  if (!env) return -1;
  if (cancelled(s.job)) return GIT_EUSER;
  auto count = static_cast<jsize>(std::min(length, size_t(65536)));
  auto bytes = env->NewByteArray(count);
  env->SetByteArrayRegion(bytes, 0, count, reinterpret_cast<const jbyte *>(input));
  auto written = env->CallIntMethod(s.connection, s.write, bytes);
  env->DeleteLocalRef(bytes);
  return exception(env) ? -1 : written;
}
int tlsClose(git_stream *base) {
  auto &s = *reinterpret_cast<TlsStream *>(base);
  AttachedEnv attached(s.job->vm);
  if (!attached.env) return -1;
  attached.env->CallVoidMethod(s.connection, s.close);
  return exception(attached.env) ? -1 : 0;
}
void tlsFree(git_stream *base) {
  auto s = reinterpret_cast<TlsStream *>(base);
  tlsClose(base);
  AttachedEnv attached(s->job->vm);
  if (attached.env) attached.env->DeleteGlobalRef(s->connection);
  delete s;
}
int tlsNew(git_stream **output, const char *host, const char *port) {
  if (!activeJob) { git_error_set_str(GIT_ERROR_SSL, "No native Git job"); return -1; }
  AttachedEnv attached(activeJob->vm);
  auto env = attached.env;
  if (!env) return -1;
  auto name = env->NewStringUTF(host);
  auto connection = env->CallObjectMethod(activeJob->callback, activeJob->tls, name, static_cast<jint>(std::stoi(port)));
  env->DeleteLocalRef(name);
  if (exception(env) || !connection) return -1;
  auto s = std::make_unique<TlsStream>();
  s->job = activeJob;
  s->connection = env->NewGlobalRef(connection);
  auto type = env->GetObjectClass(connection);
  s->connect = env->GetMethodID(type, "connect", "()V");
  s->certificate = env->GetMethodID(type, "certificate", "()[B");
  s->read = env->GetMethodID(type, "read", "(I)[B");
  s->write = env->GetMethodID(type, "write", "([B)I");
  s->close = env->GetMethodID(type, "close", "()V");
  env->DeleteLocalRef(type);
  env->DeleteLocalRef(connection);
  s->stream.version = GIT_STREAM_VERSION;
  s->stream.encrypted = 1;
  s->stream.connect = tlsConnect;
  s->stream.certificate = tlsCertificate;
  s->stream.read = tlsRead;
  s->stream.write = tlsWrite;
  s->stream.close = tlsClose;
  s->stream.free = tlsFree;
  *output = &s.release()->stream;
  return 0;
}
void initialize() {
  am_git_version();
  static std::once_flag registered;
  std::call_once(registered, [] {
    git_stream_registration registration{GIT_STREAM_VERSION, tlsNew, nullptr};
    git_stream_register(GIT_STREAM_TLS, &registration);
  });
}
std::string text(JNIEnv *env, jstring value) {
  const char *chars = env->GetStringUTFChars(value, nullptr);
  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}
} // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_expo_modules_agentmobile_git_NativeGit_version(JNIEnv *env, jobject) {
  initialize();
  return env->NewStringUTF(am_git_version());
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_expo_modules_agentmobile_git_NativeGit_run(JNIEnv *env, jobject, jstring root, jstring phase, jstring remote, jobject callback) {
  initialize();
  auto type = env->GetObjectClass(callback);
  JavaVM *vm = nullptr;
  env->GetJavaVM(&vm);
  Job job{vm, env->NewGlobalRef(callback),
    env->GetMethodID(type, "onProgress", "(Ljava/lang/String;IIJ)V"),
    env->GetMethodID(type, "isCancelled", "()Z"),
    env->GetMethodID(type, "tls", "(Ljava/lang/String;I)Lexpo/modules/agentmobile/git/AndroidTlsConnection;")};
  env->DeleteLocalRef(type);
  activeJob = &job;
  char *report = am_git_probe(text(env, root).c_str(), text(env, phase).c_str(), text(env, remote).c_str(), {&job, progress, cancelled});
  activeJob = nullptr;
  env->DeleteGlobalRef(job.callback);
  auto length = static_cast<jsize>(std::strlen(report));
  auto result = env->NewByteArray(length);
  env->SetByteArrayRegion(result, 0, length, reinterpret_cast<const jbyte *>(report));
  am_git_free(report);
  return result;
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_expo_modules_agentmobile_git_NativeGit_execute(JNIEnv *env, jobject, jstring root, jbyteArray input, jobject callback) {
  initialize();
  auto type = env->GetObjectClass(callback);
  JavaVM *vm = nullptr; env->GetJavaVM(&vm);
  Job job{vm, env->NewGlobalRef(callback),
    env->GetMethodID(type, "onProgress", "(Ljava/lang/String;IIJ)V"),
    env->GetMethodID(type, "isCancelled", "()Z"),
    env->GetMethodID(type, "tls", "(Ljava/lang/String;I)Lexpo/modules/agentmobile/git/AndroidTlsConnection;")};
  env->DeleteLocalRef(type);
  std::string request(env->GetArrayLength(input), '\0');
  env->GetByteArrayRegion(input, 0, request.size(), reinterpret_cast<jbyte *>(request.data()));
  activeJob = &job;
  char *report = am_git_execute(text(env, root).c_str(), request.c_str(), {&job, progress, cancelled});
  activeJob = nullptr; env->DeleteGlobalRef(job.callback);
  auto size = static_cast<jsize>(std::strlen(report)); auto result = env->NewByteArray(size);
  env->SetByteArrayRegion(result, 0, size, reinterpret_cast<const jbyte *>(report));
  am_git_free(report); return result;
}
