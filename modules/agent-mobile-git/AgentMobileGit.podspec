Pod::Spec.new do |s|
  s.name = 'AgentMobileGit'
  s.version = '0.1.0'
  s.summary = 'Agent Mobile native Git and controlled workspace storage'
  s.description = 'The libgit2 application backend with a debug-only isolated validation probe.'
  s.license = { :type => 'MIT', :file => '../../LICENSE' }
  s.author = 'Agent Mobile'
  s.homepage = 'https://libgit2.org'
  # Local Expo module: CocoaPods resolves this pod with :path.
  s.source = { :git => '' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/*.{h,mm,swift}'
  s.public_header_files = 'ios/AMGitProbeRunner.h'
  s.vendored_frameworks = 'ios/Frameworks/AgentMobileGitCore.xcframework'
  s.resources = '../../licenses/native-git.txt'
  s.frameworks = 'Foundation', 'Security', 'CoreFoundation'
  s.libraries = 'c++', 'z', 'iconv'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17'
  }
end
