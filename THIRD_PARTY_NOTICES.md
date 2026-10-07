# 第三方来源与资源说明

本项目的客户端及连接器源码按根目录 `LICENSE` 中的 GNU AGPL-3.0 发布。第三方库和美术资源保留各自的许可；源码许可不替代第三方角色、商标、游戏或素材的授权。

| 内容 | 来源与许可 |
| --- | --- |
| Electron、React、Vite、zustand、bcryptjs、JSZip、sql.js 等 | 依赖版本锁定在 `package-lock.json`；各包中的许可证及版权声明保留，通常为 MIT、ISC 或 Apache-2.0 等。 |
| 抖音连接方法与签名模块 | `connector-assets/douyin_room.py` 记录参考 [saermart/DouyinLiveWebFetcher](https://github.com/saermart/DouyinLiveWebFetcher)。上游 `LICENSE` 为 AGPL-3.0；上游 README 另有使用声明，请同时阅读原项目。项目内连接器进行了独立接口封装与功能修改。 |
| Twemoji 表情图 | 来源 [jdecked/twemoji](https://github.com/jdecked/twemoji)，图形按 CC-BY-4.0；完整许可及署名在 `assets/emoji72/`。 |
| Fredoka、Nunito、站酷快乐体字体 | 来源 [Google Fonts](https://fonts.google.com/)，按 SIL Open Font License 1.1；许可文件在 `src/renderer/public/pet-skins/`。数字字体为使用字符的子集。 |
| 文渊圆体（WenYuan Rounded SC） | 来源 [takushun-wu/WenYuanFonts](https://github.com/takushun-wu/WenYuanFonts) v1.100，按 SIL Open Font License 1.1。萌宠皮肤使用改名后的静态子集 `pet-round-cjk.woff2`，来源与许可见 `src/renderer/public/pet-skins/PetRound-SOURCE.txt`、`PetRound-OFL.md`。 |
| 萌宠皮肤图像 | 在本项目制作过程中使用图像生成工具制作。部分角色参考了 Maltese 线条小狗等形象；不主张第三方角色或商标的权利，也不通过源码许可授予这些权利。美术资源未单独授予 AGPL 源码许可之外的第三方角色授权。 |
| 平台礼物图、游戏封面与游戏标识 | 属于各自权利人。源码仓库保留读取、同步及用户导入能力，未将这些平台资源声明为本项目原创或重新许可。 |
| 特色整蛊素材 | `assets/special-games/` 中的图片、音效和视频不随源码仓库分发，也不在源码许可范围内；权利归各自权利人。 |
| 盲盒开奖配音 | 由微软 Edge 在线朗读语音生成（`src/main/edge-tts.ts`）。安装包随带的常用句子事先生成好放在 `assets/special-games/box_voice/`；主播自己写的台词、换用的声音在开奖时联网生成，只把那一句文字发给该服务，结果缓存在本机。 |
| FFmpeg | 正式安装包使用 Gyan.dev 分发的 FFmpeg 构建，保留该分发包自带的许可。源码仓库不存放 FFmpeg 可执行文件，可按构建说明自行准备。 |
| 嵌入式 Python 与游戏 Mod | 是单独的运行时/游戏资源，不属于本客户端源码的重新授权范围；源码仓库不存放其安装包、游戏 DLL、用户数据或私钥。 |

第三方贡献者及软件包的原始许可优先适用于对应文件。对外使用角色美术、平台礼物图或游戏标识时，应自行确认相应资源的使用权。
