#import "AMGitProbeRunner.h"
#include <probe.h>
#include <repository.h>
#include <atomic>

@interface AMGitProbeJob : NSObject {
@public
  std::atomic<bool> cancelled;
}
@property(nonatomic, copy) AMGitProgress progress;
@end
@implementation AMGitProbeJob
@end

@implementation AMGitProbeRunner {
  NSLock *_lock;
  NSMutableDictionary<NSString *, AMGitProbeJob *> *_jobs;
  NSMutableSet<NSString *> *_cancelled;
  BOOL _closed;
}
- (instancetype)init {
  if ((self = [super init])) { _lock = [NSLock new]; _jobs = [NSMutableDictionary new]; _cancelled = [NSMutableSet new]; }
  return self;
}
- (NSString *)version { return @(am_git_version()); }
- (NSString *)execute:(NSString *)projectId operationId:(NSString *)operationId request:(NSString *)request
              progress:(AMGitProgress)progress error:(NSError **)error {
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^[a-zA-Z0-9-]{1,80}$" options:0 error:nil];
  NSRegularExpression *jobPattern = [NSRegularExpression regularExpressionWithPattern:@"^[a-zA-Z0-9-]{1,100}$" options:0 error:nil];
  if ([pattern numberOfMatchesInString:projectId options:0 range:NSMakeRange(0, projectId.length)] != 1 || [jobPattern numberOfMatchesInString:operationId options:0 range:NSMakeRange(0, operationId.length)] != 1) {
    if (error) *error = [NSError errorWithDomain:@"AgentMobileGit" code:2 userInfo:@{NSLocalizedDescriptionKey: @"Invalid repository identity"}];
    return nil;
  }
  NSMutableDictionary *input = [[NSJSONSerialization JSONObjectWithData:[request dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingMutableContainers error:error] mutableCopy];
  if (![input isKindOfClass:NSMutableDictionary.class]) return nil;
  input[@"projectId"] = projectId;
  NSURL *exportCache = [[NSFileManager defaultManager] URLForDirectory:NSCachesDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:error];
  if (!exportCache) return nil;
  input[@"exportDirectory"] = [[exportCache.URLByResolvingSymlinksInPath URLByAppendingPathComponent:@"agent-mobile-exports" isDirectory:YES] URLByAppendingPathComponent:operationId isDirectory:YES].path;
  NSData *serialized = [NSJSONSerialization dataWithJSONObject:input options:0 error:error];
  if (!serialized) return nil;
  NSString *json = [[NSString alloc] initWithData:serialized encoding:NSUTF8StringEncoding];
  NSURL *documents = [[NSFileManager defaultManager] URLForDirectory:NSDocumentDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:error];
  if (!documents) return nil;
  NSURL *root = [[[documents.URLByResolvingSymlinksInPath URLByAppendingPathComponent:@"agent-mobile/workspaces" isDirectory:YES] URLByAppendingPathComponent:projectId isDirectory:YES] URLByAppendingPathComponent:@"repository" isDirectory:YES];
  if (![root.URLByResolvingSymlinksInPath.path isEqual:root.URLByStandardizingPath.path]) {
    if (error) *error = [NSError errorWithDomain:@"AgentMobileGit" code:2 userInfo:@{NSLocalizedDescriptionKey: @"Repository path crosses a symbolic link"}];
    return nil;
  }
  AMGitProbeJob *job = [AMGitProbeJob new]; job->cancelled.store(false); job.progress = progress;
  [_lock lock]; BOOL busy = _jobs[operationId] != nil;
  if (!busy) { _jobs[operationId] = job; if (_closed || [_cancelled containsObject:operationId]) job->cancelled.store(true); [_cancelled removeObject:operationId]; }
  [_lock unlock];
  if (busy) {
    if (error) *error = [NSError errorWithDomain:@"AgentMobileGit" code:3 userInfo:@{NSLocalizedDescriptionKey: @"Git operation already running"}];
    return nil;
  }
  @try {
    am_git_callbacks callbacks = {(__bridge void *)job,
      [](void *context, const char *stage, unsigned int done, unsigned int total, unsigned long long bytes) {
        @autoreleasepool { ((__bridge AMGitProbeJob *)context).progress(@(stage), done, total, bytes); }
      }, [](void *context) -> int { return ((__bridge AMGitProbeJob *)context)->cancelled.load(); }};
    char *result = am_git_execute(root.fileSystemRepresentation, json.UTF8String, callbacks);
    NSString *output = @(result); am_git_free(result);
    if ([input[@"method"] isEqual:@"fileExport"]) {
      NSMutableDictionary *response = [NSJSONSerialization JSONObjectWithData:[output dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingMutableContainers error:error];
      if (!response) return nil;
      if ([response[@"ok"] boolValue]) response[@"value"] = [NSURL fileURLWithPath:response[@"value"]].absoluteString;
      NSData *data = [NSJSONSerialization dataWithJSONObject:response options:0 error:error];
      return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
    }
    return output;
  } @finally { [_lock lock]; [_jobs removeObjectForKey:operationId]; [_lock unlock]; }
}
- (NSString *)run:(NSString *)runId phase:(NSString *)phase remote:(NSString *)remote
          progress:(AMGitProgress)progress error:(NSError **)error {
#if !DEBUG
  if (error) *error = [NSError errorWithDomain:@"AgentMobileGit" code:1 userInfo:@{NSLocalizedDescriptionKey: @"Development-only Git probe"}];
  return nil;
#else
  NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"^[a-zA-Z0-9-]{1,64}$" options:0 error:nil];
  BOOL valid = [pattern numberOfMatchesInString:runId options:0 range:NSMakeRange(0, runId.length)] == 1 &&
    [@[@"local", @"https", @"cancel", @"prepare-restart", @"resume-restart"] containsObject:phase];
  if ([phase isEqualToString:@"https"] || [phase isEqualToString:@"cancel"]) {
    NSURLComponents *url = [NSURLComponents componentsWithString:remote];
    valid = valid && [url.scheme isEqualToString:@"https"] && url.host.length > 0 &&
      url.user == nil && url.password == nil && url.query == nil && url.fragment == nil;
  }
  if (!valid) {
    if (error) *error = [NSError errorWithDomain:@"AgentMobileGit" code:2 userInfo:@{NSLocalizedDescriptionKey: @"Invalid probe arguments"}];
    return nil;
  }
  AMGitProbeJob *job = [AMGitProbeJob new];
  job->cancelled.store(false);
  job.progress = progress;
  [_lock lock];
  BOOL busy = _jobs[runId] != nil;
  if (!busy) { _jobs[runId] = job; if (_closed || [_cancelled containsObject:runId]) job->cancelled.store(true); [_cancelled removeObject:runId]; }
  [_lock unlock];
  if (busy) {
    if (error) *error = [NSError errorWithDomain:@"AgentMobileGit" code:3 userInfo:@{NSLocalizedDescriptionKey: @"Probe is already running"}];
    return nil;
  }
  @try {
    NSURL *cache = [[NSFileManager defaultManager] URLForDirectory:NSCachesDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:error];
    if (!cache) return nil;
    NSURL *root = [[cache URLByAppendingPathComponent:@"agent-mobile-git-probes" isDirectory:YES] URLByAppendingPathComponent:runId isDirectory:YES];
    am_git_callbacks callbacks = {(__bridge void *)job,
      [](void *context, const char *stage, unsigned int done, unsigned int total, unsigned long long bytes) {
        AMGitProbeJob *job = (__bridge AMGitProbeJob *)context;
        job.progress(@(stage), done, total, bytes);
      },
      [](void *context) -> int { return ((__bridge AMGitProbeJob *)context)->cancelled.load(); }};
    char *report = am_git_probe(root.fileSystemRepresentation, phase.UTF8String, remote.UTF8String, callbacks);
    NSString *result = @(report);
    am_git_free(report);
    if (![result writeToURL:[root URLByAppendingPathComponent:[phase stringByAppendingString:@".json"]]
                atomically:YES encoding:NSUTF8StringEncoding error:error]) return nil;
    return result;
  } @finally {
    [_lock lock];
    [_jobs removeObjectForKey:runId];
    [_lock unlock];
  }
#endif
}
- (void)cancel:(NSString *)runId {
  [_lock lock];
  AMGitProbeJob *job = _jobs[runId];
  if (job) job->cancelled.store(true);
  else if (!_closed) [_cancelled addObject:runId];
  [_lock unlock];
}
- (void)close {
  [_lock lock];
  _closed = YES; [_cancelled removeAllObjects];
  for (AMGitProbeJob *job in _jobs.allValues) job->cancelled.store(true);
  [_lock unlock];
}
@end
