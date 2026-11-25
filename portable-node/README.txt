portable-node 目录说明
======================

1. 目录用途
本目录用于存放官方预编译的 Node.js LTS 便携压缩包（免安装版），由内网分发服务
biz-design-agent serve-dist 通过 /portable-node/<文件名> 对外提供下载。

当同事电脑未安装 Node.js（或版本 < 18）时，AI 助手会按照 /bootstrap.md 引导，
直接通过命令行从本分发服务下载对应平台架构的便携包，解压到
~/.biz-design-agent/runtime/node 并在 ~/.biz-design-agent/runtime/node-path.txt
记录路径，后续全程使用该便携版 Node（无需安装 nvm，无需系统管理员权限）。

2. 为什么压缩包不提交到 Git
单个平台的 Node.js 便携包约 30-50 MB，多平台合计超过 100 MB，会明显增大 Git 仓库体积。
因此 .gitignore 已忽略本目录下的 .tar.gz / .zip 等压缩包文件，Git 仅保留本说明文件。
部署上线时，将本地下载好的压缩包手动上传到服务器的同名 portable-node/ 目录即可
（也可通过 --portable-node-dir 或环境变量 BIZ_DESIGN_PORTABLE_NODE_DIR 指定目录）。

3. 分发路由与自动匹配规则
- macOS Apple Silicon (M 系列): /portable-node/darwin-arm64.tar.gz
  自动匹配本目录中最新版本的 node-v*-darwin-arm64.tar.gz
- macOS Intel: /portable-node/darwin-x64.tar.gz
  自动匹配本目录中最新版本的 node-v*-darwin-x64.tar.gz
- Windows 64 位: /portable-node/win-x64.zip
  自动匹配本目录中最新版本的 node-v*-win-x64.zip
- Linux x64（可选）: /portable-node/linux-x64.tar.gz
  自动匹配本目录中最新版本的 node-v*-linux-x64.tar.gz
- 资源清单接口: /portable-node/index.json

4. 官方线上下载地址（Node.js v26.13.1 Active LTS）
- macOS Apple Silicon: https://nodejs.org/dist/v26.13.1/node-v26.13.1-darwin-arm64.tar.gz
- macOS Intel:         https://nodejs.org/dist/v26.13.1/node-v26.13.1-darwin-x64.tar.gz
- Windows x64:         https://nodejs.org/dist/v26.13.1/node-v26.13.1-win-x64.zip
- SHA256 校验文件:      https://nodejs.org/dist/v26.13.1/SHASUMS256.txt
