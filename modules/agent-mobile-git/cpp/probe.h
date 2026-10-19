#pragma once

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  void *context;
  void (*progress)(void *, const char *, unsigned int, unsigned int, unsigned long long);
  int (*cancelled)(void *);
} am_git_callbacks;

/* root is a native-owned, isolated validation directory, never a caller path. */
const char *am_git_version(void);
char *am_git_probe(const char *root, const char *phase, const char *remote_url,
                   am_git_callbacks callbacks);
void am_git_free(char *value);

#ifdef __cplusplus
}
#endif
