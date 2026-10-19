#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
typedef void (^AMGitProgress)(NSString *phase, NSUInteger completed, NSUInteger total, unsigned long long bytes);
@interface AMGitProbeRunner : NSObject
- (NSString *)version;
- (nullable NSString *)execute:(NSString *)projectId operationId:(NSString *)operationId request:(NSString *)request
                     progress:(AMGitProgress)progress error:(NSError **)error;
- (nullable NSString *)run:(NSString *)runId phase:(NSString *)phase remote:(NSString *)remote
                  progress:(AMGitProgress)progress error:(NSError **)error;
- (void)cancel:(NSString *)runId;
- (void)close;
@end
NS_ASSUME_NONNULL_END
