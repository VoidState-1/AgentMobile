#pragma once
#include "probe.h"

#ifdef __cplusplus
extern "C" {
#endif
/** Native-owned repository root. JSON never accepts another root, gitdir or shell command. */
char *am_git_execute(const char *root, const char *request, am_git_callbacks callbacks);
#ifdef __cplusplus
}
#endif
