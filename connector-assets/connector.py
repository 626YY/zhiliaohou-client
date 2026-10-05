#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
connector.py —— WheelLive「连接直播间」外部连接器。

它做的事很简单：把「直播间的礼物 / 点赞」变成一行行文本，追加写进事件桥文件 bridge.txt，
游戏里的 WheelLive mod 每帧读增量、自动触发整蛊。mod 只认统一的事件行，跟平台怎么变无关：
    gift <礼物名> [连送数]
    like <增量>
    ping                     # 保活心跳(没礼物没点赞时也发，维持「已连接●」)
    status <一句话>          # 连接器状态上报(连接失败/未开播等)→游戏里直播页显示

两种模式：
  --sim                 纯模拟：定时造假礼物/假点赞(零依赖,命令行自测整条链路用)
  --room <直播间号>      连真抖音直播间(经 douyin_room.py)。
                        ★连不上就诚实报错(status 行+日志)并退出——绝不偷偷降级成模拟礼物，
                          否则主播会以为连上了自己的直播间，实际全是假数据。

另外：进程内附带「云端」后台线程(总分榜上报 + 版本推送)，配置读同目录 cloud.json；
      ★游戏进程绝不联网，所有服务器往来都在本连接器里(见下面 Cloud 类)。

用法：
  python connector.py --sim --bridge "F:\\...\\Mods\\WheelLive\\bridge.txt"
  python connector.py --room 123456789 --bridge "F:\\...\\Mods\\WheelLive\\bridge.txt" --version 0.9.9

mod 里的【连接】按钮：填直播间号→启动本脚本 --room(不填号不启动，也没有演示假数据了)。
"""
import argparse, os, sys, time, random, threading, json, re
import subprocess   # ★★2026-07-16：这行【本来就没有】，而 subprocess 被用在三处：
                    #   run_installupdate 的 subprocess.call(真正执行安装的那一句) / _game_running 的 subprocess.run /
                    #   躲 pyembed 自锁的 subprocess.Popen。→ 「内置更新」从出生起就是【必死】的：
                    #   点「立即更新」→ 游戏关掉 → NameError → rc=-1 → 什么都没装。
                    #   ★为什么两个多月没人发现：它从来没被真跑过一次(待办上一直写着「已写完编译进，从未实测」)。
                    #     而且 _game_running 的 `except: return False` 把自己的 NameError 吞了、谎报「游戏没在跑」——
                    #     两层静默叠一起，连日志都没有(那时 log() 只 print 进一个已死的管道)。
                    #   ★这个 bug 是被【同一天刚加的 update_log.txt 落盘日志】第一次睁眼就逮到的。
import urllib.request, urllib.error, urllib.parse
import ssl

# ★★榜单时间窗数：必须和 mod 的 `Records.Windows.Count`、服务端的 `WINDOWS` 三处【同时】一致。
#   线上序 0今日 1本周 2本月 **3总** 4本年 —— **只能追加，永不重排**(3=总 是既有协议常量，
#   现网老连接器全靠它拿总榜；重排 = 全网老客户端的「总榜」当场显示成别的数)。
#   ★这个数少改一处就【静默丢】：历史上 mod 和服务端都改对了、数据卡死在【连接器这道中间门】里
#     原地蒸发，不报错不掉线，榜单照常显示、只是永远少一半 —— 见下面 report_board 里那段血泪注释。
WINDOWS = 5

# ★把本脚本所在目录放到 sys.path 最前：嵌入式 python(pyembed 带 python311._pth)不会自动把「脚本目录」
#   加进 sys.path，否则同目录的 `from douyin_room import ...` 会报 ModuleNotFoundError，被 run_room 误报成
#   "缺少弹幕组件 douyin_room.py"。系统 python 会自动加脚本目录、无此问题——所以 dev(系统py)能连、小白(pyembed)连不上。
_SELF_DIR = os.path.dirname(os.path.abspath(__file__))
# 客户端按这个标记把游戏目录里更旧的 connector.py 换成自带的新版（YYYY-MM-DD[.n]，按字串比较；没有标记的副本不动）
CONNECTOR_VERSION = "2026-10-05.1"
if _SELF_DIR and _SELF_DIR not in sys.path:
    sys.path.insert(0, _SELF_DIR)

# 仅 --sim 命令行自测用的假礼物名（游戏内不再有演示连接；正式用只走 --room 真直播间）。
# 实事求是：用真实存在的抖音礼物名，别造观众看不懂的假礼物。
PRESET_GIFTS = ["小心心", "玫瑰", "抖音", "加油鸭", "大啤酒", "棒棒糖",
                "热气球", "保时捷", "直升机", "嘉年华", "游艇", "独角兽"]
# --sim 造假送礼人，好让观众榜在命令行自测里也累计出来
SIM_FANS = ["阿强", "小美吖", "老王头", "阿彪", "球球", "大熊", "快乐可乐", "喵酱"]


_LOGF = [None]   # 不为 None 时，log() 除了 print 还往这个文件追加一份


def _oneline(s):
    """昵称/弹幕压成一行：观众能在昵称或弹幕里塞换行，不压的话 stdout 会多出一行「礼物: 嘉年华 x99 by 我」这种伪造事件行。"""
    return " ".join(str(s if s is not None else "").split())


def log(msg):
    print("[connector] " + msg, flush=True)
    # ★★内置更新专用的落盘日志(2026-07-16 补)。为什么非加不可：
    #   `--installupdate` 是【唯一在游戏已经关掉之后才执行】的一段代码，而 mod 侧 InstallUpdateNow 特意
    #   不接管子进程的 stdout(免得挂住)、拉起来就 Application.Quit() —— 于是这里 print 的每一个字都写进
    #   一个【已经死掉的管道】。装成了没装成、rc 是几、卡在哪一步，全部消失在虚空。
    #   真实用户更新失败时，我手上会一条线索都没有 —— 这就是本项目那个「静默失败」老毛病最纯粹的形态。
    #   ★只在 --installupdate 里开(run_installupdate 里设 _LOGF)；常驻连接器不写，免得平白每天涨一个日志文件。
    #   ★落在安装包旁边(~/Downloads/WheelLive更新/v<版本>/)，不落游戏目录：安装包会覆盖游戏目录，
    #     日志得活过这次安装才有用。★路径含 Windows 用户名 → 绝不能进 /api/error 回传(隐私铁律)，只给主播自己截图。
    f = _LOGF[0]
    if f:
        try:
            with open(f, "a", encoding="utf-8") as fh:
                fh.write(time.strftime("%H:%M:%S ") + msg + "\n")
        except Exception:
            pass   # 日志写不进去绝不能反过来搞崩更新本身


_singleton_handle = None   # 具名互斥量句柄：全局持有，进程活着就别释放(否则锁会没)


def acquire_single_instance(bridge_path):
    """保证「同一个事件桥」同时只有一个连接器在跑。多开会让每个礼物被每个实例各上报一次
       → 观众看到礼物 ×2/×3、连击翻倍(用户反馈过)。这里按事件桥路径做独占：
         · Windows：具名 Mutex(进程退出由系统自动释放，最稳，崩溃也不会留死锁)。
         · 其它平台：PID 锁文件(存活校验，陈旧锁自动接管)。
       返回 True=拿到独占(可继续)；False=已有一个在跑(应退出)。建锁本身失败一律放行(True，绝不误拦)。"""
    global _singleton_handle
    import hashlib
    key = hashlib.md5(os.path.abspath(bridge_path).encode("utf-8", "ignore")).hexdigest()[:16]
    if os.name == "nt":
        try:
            import ctypes
            name = "WheelLiveConnector_" + key      # 会话内唯一(同用户多开必撞)；不用 Global 前缀免权限问题
            k32 = ctypes.windll.kernel32
            h = k32.CreateMutexW(None, False, name)
            if not h:
                return True                          # 建不出锁 → 别拦
            if k32.GetLastError() == 183:            # ERROR_ALREADY_EXISTS：已有实例持锁
                k32.CloseHandle(h)
                return False
            _singleton_handle = h                    # 持有到进程结束
            return True
        except Exception:
            return True
    try:
        lock = bridge_path + ".connlock"
        if os.path.isfile(lock):
            try:
                old = int((open(lock, "r", encoding="utf-8").read().strip() or "0"))
            except Exception:
                old = 0
            alive = False
            if old > 0:
                try:
                    os.kill(old, 0); alive = True    # 信号0：只探活不影响进程
                except OSError:
                    alive = False
            if alive:
                return False
        with open(lock, "w", encoding="utf-8") as f:
            f.write(str(os.getpid()))
        return True
    except Exception:
        return True


class Bridge:
    """只负责把事件行「追加」写进 bridge.txt（UTF-8，行尾换行）。mod 那边按增量读。

    ★断档礼物不吞(2026-08-09 用户「观众送的礼物不能被吞掉,等打开游戏房间以后还要继续出票」)：
      mod 启动时只读 bridge.txt 的【新增量】(防重放历史)——游戏关着/炸毁/没进房期间写进去的礼物
      以前会整批被跳过=观众白送。现在：
      · mod 每 5s 写 hb.json {"ts":unix,"in":0/1}(活着+进没进房)
      · 值钱事件(gift/like/follow/badge)在「游戏不在房内」时改排 pending_gifts.jsonl(落盘,崩溃/炸毁都不丢)
      · tick_pending() 检测到进房后,按 1.6s/条限速补发出票(别一秒全炸成一坨)
      · 其它命令(状态/心跳类)照旧直写——丢了无所谓
      pending 封顶 5000 条(超了丢最老)。mod 侧协议零改动,老版 mod 拿到的只是"晚到的正常事件行"。"""
    PRECIOUS = ("gift ", "like ", "follow", "badge", "fansclub")

    def __init__(self, path):
        self.path = path
        d = os.path.dirname(path)
        if d and not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
        self.hb_path = os.path.join(d, "hb.json") if d else "hb.json"
        self.pend_path = os.path.join(d, "pending_gifts.jsonl") if d else "pending_gifts.jsonl"
        # websocket 回调线程写入礼物，pending 补发线程同时读/改同一个文件；必须让一次
        # "读快照→发送→替换" 成为不可分割的操作，否则新礼物会被旧快照覆盖。
        self._lock = threading.RLock()
        self._replay_next = 0.0
        n = self._pending_count()
        if n:
            log("断档礼物队列:发现 %d 条待补发(等游戏进房后限速出票)" % n)

    def _game_in_room(self):
        # hb.json 新鲜(<15s)且 in=1 = mod 活着且主播在对局里。读不到/过期一律按「不在」。
        try:
            with open(self.hb_path, "r", encoding="utf-8") as f:
                hb = json.load(f)
            # 新版 mod 在 Bridge 把文件读指针定位好前写 ready=0；旧版没有该字段时保留兼容行为。
            ready = int(hb.get("ready", 1))
            return (time.time() - float(hb.get("ts", 0))) < 15 and ready == 1 and int(hb.get("in", 0)) == 1
        except Exception:
            return False

    def _pending_count(self):
        with self._lock:
            try:
                if not os.path.isfile(self.pend_path):
                    return 0
                with open(self.pend_path, "r", encoding="utf-8") as f:
                    return sum(1 for ln in f if ln.strip())
            except Exception:
                return 0

    def _pend_append(self, line):
        try:
            with self._lock:
                with open(self.pend_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps({"ts": int(time.time()), "line": line}, ensure_ascii=False) + "\n")
            return True
        except Exception as e:
            log("礼物排队失败: %r" % e)
            return False

    def _raw_send(self, line):
        try:
            text = str(line or "").rstrip("\n")
            if not text.strip():
                log("写 bridge 拒绝空事件行")
                return False
            with self._lock:
                with open(self.path, "a", encoding="utf-8") as f:
                    f.write(text + "\n")
            return True
        except Exception as e:
            log("写 bridge 失败: %r" % e)
            return False

    def _pending_replace(self, lines):
        """在持锁状态下更新 pending；失败时保留原文件，宁可重复补发也不静默丢礼物。"""
        try:
            if lines:
                tmp = self.pend_path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    f.writelines(lines)
                os.replace(tmp, self.pend_path)
            else:
                try:
                    os.remove(self.pend_path)
                except FileNotFoundError:
                    pass
            return True
        except Exception as e:
            log("更新礼物待发队列失败(原记录保留): %r" % e)
            return False

    def send(self, line):
        s = line.lstrip()
        precious = any(s.startswith(p) for p in self.PRECIOUS)
        with self._lock:
            for p in self.PRECIOUS:
                if s.startswith(p):
                    # ★兼容闸：hb.json 不存在=老版 mod(还没有心跳)——无从判断进没进房,恢复旧行为直写,
                    #   绝不把礼物排进一个永远没人放行的队列。只有「hb 存在但过期/不在房」才排队。
                    if os.path.isfile(self.hb_path) and not self._game_in_room():
                        if self._pend_append(line):
                            return True
                        # 磁盘队列失败时仍尝试直接写桥；两条路都失败才算真正失败。
                        log("礼物待发落盘失败，尝试直接写 bridge")
                        return self._raw_send(line)
                    break
            if self._raw_send(line):
                return True
            if precious:
                # 进房状态可能刚好有效但 bridge 写入失败；值钱事件转入 pending，等待下一拍重试。
                log("礼物直写 bridge 失败，转入待发队列")
                return self._pend_append(line)
            return False

    def tick_pending(self):
        # 主循环每拍调：进房了就把 pending 逐条限速补发(1.6s/条,一次一条,平滑出票)。
        now = time.time()
        with self._lock:
            if now < self._replay_next:
                return
            try:
                if not os.path.isfile(self.pend_path):
                    return
                # hb 存在才有「在房」判断;不存在(老版 mod)=无从判断,限速倾倒恢复旧行为
                if os.path.isfile(self.hb_path) and not self._game_in_room():
                    return
                with open(self.pend_path, "r", encoding="utf-8") as f:
                    lines = [ln for ln in f if ln.strip()]
                if not lines:
                    self._pending_replace([])
                    return
                if len(lines) > 5000:
                    dropped = len(lines) - 5000
                    log("断档礼物队列超 5000,丢弃最老 %d 条(已明确记录)" % dropped)
                    lines = lines[-5000:]
                first, rest = lines[0], lines[1:]
                try:
                    item = json.loads(first)
                    payload = item.get("line", "") if isinstance(item, dict) else ""
                    if not str(payload).strip():
                        raise ValueError("空事件行")
                except Exception as e:
                    # 坏行不能一直堵在队首，但也不能静默消失；后续有效礼物继续补发。
                    log("礼物待发队列坏行，跳过并继续(%s)" % type(e).__name__)
                    self._pending_replace(rest)
                    self._replay_next = now + 0.05
                    return

                if not self._raw_send(payload):
                    # bridge 写失败时绝不移除队首，下一拍继续尝试。
                    self._replay_next = now + 2.0
                    log("补发礼物写 bridge 失败，队首保留")
                    return

                # 只有确认写桥成功后才出队；替换失败会保留原记录，最多造成重复，不会造成吞礼。
                if self._pending_replace(rest):
                    log("补发断档礼物(剩 %d): %s" % (len(rest), str(payload)[:60]))
                self._replay_next = now + 1.6
            except Exception as e:
                self._replay_next = now + 2.0
                log("补发断档礼物失败(队列保留): %r" % e)

    def gift(self, name, count=1, sender=None, coins=None):
        # 带送礼人 → 用 | 分隔(观众榜按送礼人累计)；送礼人可能含空格，放最后最稳
        # ★抖币(coins)挂在【最后一段】：`gift <名> <数> | <送礼人> | <抖币>`。
        #   为什么不另起一段放中间：送礼人昵称里【可能真的带 |】(抖音昵称几乎啥字符都能用)，
        #   按第一个 | 切完、剩下的整段都算昵称是现有约定。所以抖币只能挂最后，且 mod 侧只在
        #   「最后一段能整数解析」时才认它是抖币——昵称正好以 "| 数字" 结尾的概率≈0，就算撞上也只是分数微偏。
        one = " ".join(str(sender).split()) if sender else ""
        if sender and coins is not None:
            return self.send("gift %s %d | %s | %d" % (name, count, one, coins))
        elif sender:
            return self.send("gift %s %d | %s" % (name, count, one))
        else:
            return self.send("gift %s %d" % (name, count))

    def like(self, delta, sender=None):
        if sender:
            self.send("like %d | %s" % (delta, " ".join(str(sender).split())))
        else:
            self.send("like %d" % delta)

    def follow(self, sender=None):
        # 新关注 → 攒盲盒。昵称可含空格，用 | 分隔(可选)。
        if sender:
            self.send("follow | %s" % " ".join(str(sender).split()))
        else:
            self.send("follow")

    def badge(self, sender=None):
        # 灯牌/粉丝团进场 → 攒盲盒。
        if sender:
            self.send("badge | %s" % " ".join(str(sender).split()))
        else:
            self.send("badge")

    def avatar(self, nick, path):
        # avatar <昵称> | <本地文件路径>：连接器下载好头像后登记(mod 按昵称读盘显示)。
        #   昵称里的 | 和换行会破坏解析，单行化并把 | 换成 /。
        if not nick or not path:
            return
        one = " ".join(str(nick).split()).replace("|", "/")
        self.send("avatar %s | %s" % (one, path))

    def ping(self):
        self.send("ping")

    def status(self, text):
        # 单行化(桥按行读)，同时打日志
        one = " ".join(str(text).split())
        log("状态: " + one)
        self.send("status " + one)


_AV_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


class AvatarCache:
    """把抖音头像下载缓存到本地 avatars/ 目录，下好后往事件桥发 `avatar 昵称|本地路径`。
       · 后台线程池下载(不阻塞弹幕收取)；同一昵称同一 URL 只下一次；文件名按昵称哈希，稳定覆盖旧头像。
       · 长时间直播防塞盘：缓存文件超过上限就删最旧的几张。拿不到/下失败 → 静默(mod 那边画首字色块兜底)。"""
    def __init__(self, bridge, cache_dir, stop, max_files=600, workers=2):
        self.bridge = bridge
        self.dir = cache_dir
        self.stop = stop
        self.max_files = max_files
        self._done = {}            # 昵称 -> 已下载的 url(变了才重下；超 DONE_MAX 条丢最早的)
        self._q = []               # 待下载 (昵称, url)：礼物/主播头像，高优先级
        self._q_low = []           # 待下载 (昵称, url)：进场/弹幕观众头像，低优先级、有上限
        self._low_dropped = 0      # 低优先级车道因排满而丢掉的次数(只计数，普查/排障看)
        self._qset = set()         # 去重：正在排队的昵称
        self._lock = threading.Lock()
        self._enabled = True
        try:
            os.makedirs(cache_dir, exist_ok=True)
        except Exception as e:
            log("头像缓存目录建不了(%r)，头像功能停用" % e)
            self._enabled = False
        try:
            import requests  # noqa
            self._requests = requests
        except Exception:
            self._enabled = False
            self._requests = None
        self._threads = []
        if self._enabled:
            for _ in range(max(1, workers)):
                t = threading.Thread(target=self._worker, daemon=True)
                t.start()
                self._threads.append(t)

    @staticmethod
    def _safe_name(nick):
        import hashlib
        return hashlib.md5(nick.encode("utf-8", "ignore")).hexdigest()[:16]

    def _existing_path(self, nick):
        # 该昵称的头像若已缓存在本地(任一扩展名)→返回路径，否则 None。
        base = self._safe_name(nick)
        for ext in (".jpg", ".png", ".webp"):
            p = os.path.join(self.dir, base + ext)
            if os.path.isfile(p):
                return p
        return None

    def announce(self, nick):
        # 礼物到来时：若本地已有该昵称头像，立刻再发一次 avatar 行(幂等、便宜——mod 那边路径没变直接跳过)。
        #   这样即便 mod 中途重启丢了内存里的头像登记，下一个礼物就把头像重新挂回去(连接器也无需重下)。
        if not self._enabled or not nick:
            return
        nick = " ".join(str(nick).split())
        if not nick:
            return
        p = self._existing_path(nick)
        if p:
            self.bridge.avatar(nick, p)
            log("头像: %s -> %s" % (nick, p))    # 客户端（整蛊台）按这行给挂件配头像；礼物行本身不带头像

    # 低优先级车道(进场/弹幕观众的头像，2026-09-13)：礼物头像永远先下；本地已有的不重下；
    #   排队上限 LOW_PENDING_MAX，超了就丢(这位观众下次再出现会再排)——大房间一分钟几百人进场，不能把礼物头像堵在后面。
    LOW_PENDING_MAX = 150
    DONE_MAX = 4000

    def offer(self, nick, url, low=False):
        if not self._enabled or not nick or not url:
            return
        nick = " ".join(str(nick).split())
        if not nick:
            return
        if low and self._existing_path(nick):
            return                          # 进场/弹幕：已缓存就不重下(announce 那条路会把路径发出去)
        with self._lock:
            if self._done.get(nick) == url or nick in self._qset:
                return
            if low:
                if len(self._q_low) >= self.LOW_PENDING_MAX:
                    self._low_dropped += 1
                    return
                self._qset.add(nick)
                self._q_low.append((nick, url))
                return
            self._qset.add(nick)
            self._q.append((nick, url))

    def _worker(self):
        while not self.stop.is_set():
            item = None
            with self._lock:
                if self._q:
                    item = self._q.pop(0)
                elif self._q_low:
                    item = self._q_low.pop(0)
            if item is None:
                self.stop.wait(0.2)
                continue
            nick, url = item
            try:
                self._download(nick, url)
            except Exception as e:
                log("头像下载失败 %s: %r" % (nick, e))
            finally:
                with self._lock:
                    self._qset.discard(nick)

    def _download(self, nick, url):
        r = self._requests.get(url, timeout=8,
                               headers={"User-Agent": _AV_UA, "Referer": "https://live.douyin.com/"})
        if r.status_code != 200 or not r.content or len(r.content) < 64:
            return
        ct = (r.headers.get("Content-Type") or "").lower()
        ext = ".png" if "png" in ct else (".webp" if "webp" in ct else ".jpg")
        path = os.path.join(self.dir, self._safe_name(nick) + ext)
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(r.content)
        try:
            os.replace(tmp, path)     # 原子替换：mod 绝不会读到写一半的文件
        except Exception:
            path = tmp
        with self._lock:
            self._done[nick] = url
            while len(self._done) > self.DONE_MAX:
                self._done.pop(next(iter(self._done)))   # 马拉松直播防内存无限涨：丢最早登记的
        self.bridge.avatar(nick, path)
        log("头像: %s -> %s" % (nick, path))      # 下载完成 → 客户端把已上屏的同一昵称回填成真头像
        self._prune()

    def _prune(self):
        # 缓存文件太多 → 按修改时间删最旧的，留最新 max_files 张(马拉松直播防塞盘)。
        try:
            files = [os.path.join(self.dir, f) for f in os.listdir(self.dir)]
            files = [f for f in files if os.path.isfile(f) and not f.endswith(".part")]
            if len(files) <= self.max_files:
                return
            files.sort(key=lambda f: os.path.getmtime(f))
            for f in files[:len(files) - self.max_files]:
                try: os.remove(f)
                except Exception: pass
        except Exception:
            pass


class GiftImageCache:
    """把抖音礼物图下载缓存到本地 礼物图/抖音/ 目录（文件名=礼物名，客户端透明图/贴纸/动画/时间插件直接读）。
       · 后台线程池下载(不阻塞弹幕收取)；同一礼物同一 URL 只下一次。
       · 拿不到/下失败 → 静默(客户端回落文字/占位)。"""
    def __init__(self, cache_dir, stop, workers=2, max_files=200):
        self.dir = cache_dir
        self.stop = stop
        self.max_files = max_files
        self._done = {}            # 礼物名 -> 已下载的 url(变了才重下)
        self._q = []
        self._qset = set()
        self._lock = threading.Lock()
        self._enabled = True
        try:
            os.makedirs(cache_dir, exist_ok=True)
        except Exception as e:
            log("礼物图目录建不了(%r)，礼物图功能停用" % e)
            self._enabled = False
        try:
            import requests  # noqa
            self._requests = requests
        except Exception:
            self._enabled = False
            self._requests = None
        self._threads = []
        if self._enabled:
            for _ in range(max(1, workers)):
                t = threading.Thread(target=self._worker, daemon=True)
                t.start()
                self._threads.append(t)

    @staticmethod
    def _safe_name(name):
        import hashlib
        s = "".join(ch for ch in str(name or "").strip()
                    if ch not in '\\/:*?"<>|').strip()[:40]
        if not s:
            s = hashlib.md5((name or "").encode("utf-8", "ignore")).hexdigest()[:12]
        return s

    def offer(self, name, url):
        if not self._enabled or not name or not url:
            return
        name = " ".join(str(name).split())
        if not name:
            return
        with self._lock:
            if self._done.get(name) == url or name in self._qset:
                return
            self._qset.add(name)
            self._q.append((name, url))

    def _worker(self):
        while not self.stop.is_set():
            item = None
            with self._lock:
                if self._q:
                    item = self._q.pop(0)
            if item is None:
                self.stop.wait(0.2)
                continue
            name, url = item
            try:
                self._download(name, url)
            except Exception as e:
                log("礼物图下载失败 %s: %r" % (name, e))
            finally:
                with self._lock:
                    self._qset.discard(name)

    def _download(self, name, url):
        r = self._requests.get(url, timeout=8,
                               headers={"User-Agent": _AV_UA, "Referer": "https://live.douyin.com/"})
        if r.status_code != 200 or not r.content or len(r.content) < 64:
            return
        ct = (r.headers.get("Content-Type") or "").lower()
        ext = ".png" if "png" in ct else (".webp" if "webp" in ct else ".jpg")
        path = os.path.join(self.dir, self._safe_name(name) + ext)
        tmp = path + ".part"
        with open(tmp, "wb") as f:
            f.write(r.content)
        try:
            os.replace(tmp, path)
        except Exception:
            path = tmp
        with self._lock:
            self._done[name] = url
        log("礼物图: %s -> %s" % (name, path))
        self._prune()

    def _prune(self):
        try:
            files = [os.path.join(self.dir, f) for f in os.listdir(self.dir)]
            files = [f for f in files if os.path.isfile(f) and not f.endswith(".part")]
            if len(files) <= self.max_files:
                return
            files.sort(key=lambda f: os.path.getmtime(f))
            for f in files[:len(files) - self.max_files]:
                try:
                    os.remove(f)
                except Exception:
                    pass
        except Exception:
            pass


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _cloud_cfg(moddir):
    """读云端配置(server/token)：优先 cloud.json；没有或 server 为空 → 退回安装包出厂的
       cloud.default.json(修「新装机器 cloud.json 不存在→云功能全哑」)；环境变量最高优先。"""
    # 本机卡密由完整客户端取证与续租；连接器不再向旧授权/上报服务发请求。
    # 仅影响客户端明确以新卡密模式启动的子进程，不改 cloud.json 或老模式。
    if os.environ.get("ZL_CARD_MODE") == "1":
        return "", ""
    cfg = _cloud_cfg_dict(moddir)
    server = (os.environ.get("WL_SERVER") or cfg.get("server") or "").rstrip("/")
    token = os.environ.get("WL_TOKEN") or cfg.get("token") or ""
    return server, token


def _cloud_cfg_dict(moddir):
    """云端配置原始字典(cloud.json 优先，server 为空退 cloud.default.json)——除 server/token 外的
       扩展项(如 board_interval)也从这里读。"""
    cfg = _read_json(os.path.join(moddir, "cloud.json"), None)
    if not isinstance(cfg, dict) or not str(cfg.get("server") or "").strip():
        d = _read_json(os.path.join(moddir, "cloud.default.json"), None)
        if isinstance(d, dict):
            cfg = d
    return cfg if isinstance(cfg, dict) else {}


_MID_CACHE = [""]     # 机器码进程内缓存(注册表只读一次)


def machine_id():
    """本机机器码：注册表 HKLM\\SOFTWARE\\Microsoft\\Cryptography\\MachineGuid(装系统时生成，稳定)；
       读不到 → 退 uuid.getnode()(网卡 MAC)十六进制。只用于卡密「单许可单机」绑定，随心跳发给
       用户自己配置的服务器；★不含 Windows 用户名等任何个人信息。"""
    if _MID_CACHE[0]:
        return _MID_CACHE[0]
    mid = ""
    try:
        import winreg
        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography", 0,
                           winreg.KEY_READ | winreg.KEY_WOW64_64KEY)
        try:
            mid = str(winreg.QueryValueEx(k, "MachineGuid")[0]).strip()
        finally:
            winreg.CloseKey(k)
    except Exception:
        mid = ""
    if not mid:
        try:
            import uuid
            mid = "%012x" % uuid.getnode()
        except Exception:
            mid = "unknown"
    _MID_CACHE[0] = mid[:64]
    return _MID_CACHE[0]




# ---- 服务器 HTTPS（2026-09-07）：8771 是自签证书（没有域名、443 被占），证书钉在这里，不信系统 CA；

#      cloud.json 里写的还是 http://…:8770 时自动升到 https；握手/连不上就退回 http（同一进程两个监听，可用性一致）。----

_SERVER_HOST = "47.251.93.171"

_SERVER_HTTP = "http://" + _SERVER_HOST + ":8770"

_SERVER_HTTPS = "https://" + _SERVER_HOST + ":8770"   # 与明文共用 8770（服务器按首字节分流）

_SERVER_CERT_PEM = """-----BEGIN CERTIFICATE-----

MIIDTDCCAjSgAwIBAgIUAbpl9d8fPV/7fngcaFFL7j+5GVAwDQYJKoZIhvcNAQEL

BQAwLTEWMBQGA1UEAwwNNDcuMjUxLjkzLjE3MTETMBEGA1UECgwKemhpbGlhb2hv

dTAeFw0yNjA5MDcwNTIwMzdaFw0zNjA5MDQwNTIwMzdaMC0xFjAUBgNVBAMMDTQ3

LjI1MS45My4xNzExEzARBgNVBAoMCnpoaWxpYW9ob3UwggEiMA0GCSqGSIb3DQEB

AQUAA4IBDwAwggEKAoIBAQDEXgBN+u2PPvzRdPxovmGoT4rzJv60NRSDDdnqpdE3

LN1lF5TjS4hxPyD39scmqhpDwWDMZNJEg3aSNQj4WC9DTT625KeciU10JRUBxYAc

KBumQmz5jnv9UnstxsF9DQry1VVYD9DpsatsfjIWXOUL1dZzn7ALMl6txflHeeQd

zyW4bdfoawNX0ynE2RWhR0PMPyh2krfb4A8UnwaR8mxdqakWokb+HW5LDfWGWm02

nKtTz7UJGPA6eCzbCIHPKINLDPOMeK66klG8Kf5BC9l9vojubgUrHqPuLzpy59nA

bGWK7WbRv5q6V9g4rHq5PXutTePh+91A1kudoWtQEla/AgMBAAGjZDBiMB0GA1Ud

DgQWBBQZ2rF3UiCeoTWjho72XSKPe/nAfTAfBgNVHSMEGDAWgBQZ2rF3UiCeoTWj

ho72XSKPe/nAfTAPBgNVHRMBAf8EBTADAQH/MA8GA1UdEQQIMAaHBC/7XaswDQYJ

KoZIhvcNAQELBQADggEBAHA8UHINzfaBoO5ClMImwDr6VaUNM9Z8T0vR0CXDhu0E

AV+FEfq2tbW7m2+tJrlkOIP3zq7Xv+8WaEiQNRMoU6vckb4cWejBdBDzZA7v4oSS

3mVu/9mua7eyDP5bRLEzN6PxkDYc6mmNRfhGHrzImy/TLrVhKmghUjWvuDtnp0/2

ThfWz4OYYv6j+bNAswDXFg9H+/4i/3OEvF/Z12GPpWMlcOpdwbzuK4VeGJELWaxV

jFcXRtJt336q+RN9QRZiBA2f8pzYKzTjmnlnmbWSqhELL1cJdaHJuz6JakrCZbDY

nPgU1ZJL+kgtl+zqiU6CXlxn5lsV7Tvw6LZ4zCL4EWQ=

-----END CERTIFICATE-----"""

try:

    _SSL_CTX = ssl.create_default_context(cadata=_SERVER_CERT_PEM)

    _SSL_CTX.check_hostname = False          # 证书 SAN 是 IP，urllib 对 IP 主机名校验不稳，指纹由 cadata 钉死

except Exception:

    _SSL_CTX = None





def _prefer_https(server):

    s = (server or "").rstrip("/")

    if _SSL_CTX is not None and s == _SERVER_HTTP:

        return _SERVER_HTTPS

    return s





def _urlopen(req, timeout):

    """urlopen 的统一出口：https 用钉死的证书上下文。"""

    url = req.full_url if isinstance(req, urllib.request.Request) else str(req)

    if url.startswith("https://") and _SSL_CTX is not None:

        return urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX)

    return urllib.request.urlopen(req, timeout=timeout)





def _is_conn_error(e):

    """连接层失败（握手/拒绝/超时），不是服务器给的 4xx/5xx。"""

    return not isinstance(e, urllib.error.HTTPError) and isinstance(e, (urllib.error.URLError, ssl.SSLError, OSError))



def _http_json(method, url, payload=None, timeout=10):
    """极简 HTTP+JSON（一次性 sharecmd 用；常驻上报走 Cloud 类自己的 _post/_get）。"""
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with _urlopen(req, timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# 错误报告队列：mod / 连接器把出错记录追加到 Mods\WheelLive\error_queue.jsonl，
# 云端线程定期挪走整个文件回传服务器(开发者远程看报错修 bug 用)。写入方随时可重建文件，绝不互相踩。
_ERRQ = {"dir": "", "ver": "0.0.0"}


def _scrub_user(s):
    """隐私擦除：错误文案里的路径可能带 Windows 用户名(C:\\Users\\某某\\...)——抹成 ***。
       回传承诺过「不含任何个人数据」，mod 侧(Dbg.Scrub)和连接器侧都得守同一条线。"""
    try:
        u = os.environ.get("USERNAME") or os.environ.get("USER") or ""
        if len(u) >= 2 and u in s:
            s = s.replace(u, "***")
    except Exception:
        pass
    return s


def queue_error(tag, msg):
    """连接器自己的异常也进同一个队列(文件超 256KB 就不再写，防塞盘)。"""
    try:
        d = _ERRQ["dir"]
        if not d:
            return
        p = os.path.join(d, "error_queue.jsonl")
        if os.path.isfile(p) and os.path.getsize(p) > 256 * 1024:
            return
        rec = {"t": time.strftime("%Y-%m-%d %H:%M:%S"), "v": _ERRQ["ver"],
               "tag": "connector/" + tag, "msg": _scrub_user(" ".join(str(msg).split())[:500])}
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
    except Exception:
        pass


# 版本清单轮询间隔(秒)。★别再调回 6 小时：那样「正在直播的人收不到刚推的更新」，紧急修复要过半天才铺得开。
#   /api/manifest 只有几百字节，20 分钟一次对服务器和主播带宽都等于零。
UPDATE_POLL_SEC = 20 * 60


def _newer(a, b):
    """点分版本号 a > b？（缺位补 0，非数字段忽略）"""
    pa = [int(x) for x in str(a).split(".") if x.isdigit()]
    pb = [int(x) for x in str(b).split(".") if x.isdigit()]
    n = max(len(pa), len(pb))
    pa += [0] * (n - len(pa))
    pb += [0] * (n - len(pb))
    return pa > pb


# 本连接器对应客户端的游戏 id（和客户端 src/main/games.ts 的 CATALOG 保持一致）
GAME_ID = "4wheel-challenge"


class Cloud:
    """云端·总分榜上报 + 版本推送。全在这个外部进程里跑——★游戏进程绝不联网(省资源、对游戏零负担)。
       配置读同目录 cloud.json：{"server":"http://ip:port","token":"..."}（环境变量 WL_SERVER/WL_TOKEN 可覆盖）。
         · server 为空 → 整个云功能关闭，绝不联网。
         · token 为空 → 只查版本更新(GET，人人可用)，不上报分数(POST 需令牌，只有主播本人机器配了才报)。
       上报「增量」：只发自上次以来每位观众新增的送礼分，JSON 极短、低频(45s)、断网自动跳过——精简省资源。"""

    def __init__(self, moddir, room, local_version, game="4wheel-challenge"):
        self.moddir = moddir
        self.room = (str(room)[:64] or "default")
        self.local_version = str(local_version or "0.0.0")
        self.game = re.sub(r"[^a-zA-Z0-9_-]", "", str(game or ""))[:32] or "4wheel-challenge"
        self.config = os.path.join(moddir, "config.json")
        self.state = os.path.join(moddir, "cloud_state.json")   # 上次上报快照(私有·不分发)，用来算增量
        self.licfile = os.path.join(moddir, "license_status.json")  # 卡密授权态(mod 3s 节流读它显示/预留强锁)
        # ★license_status.json 现在有两个写线程(慢轮询 loop 的 check_license/_mark_apply_sent + 长轮询 waiter 的
        #   _write_lic_status)——用它串行化全部「读-改-写」，防同一 .tmp 撞车/半写/丢更新。评审确认的 MEDIUM 修复。
        self._lic_lock = threading.Lock()
        self.applyfile = os.path.join(moddir, "apply_request.json")  # mod F1「申请购买」写它，这里代发后删
        self.emailfile = os.path.join(moddir, "email_account.json")  # 客户端登录后写当前邮箱，这里查购买授权并入 licensed
        self._email_lic = 0            # 邮箱购买授权缓存 0/1
        self._email_lic_email = ""     # 上次查询的邮箱
        self._email_lic_at = 0.0       # 上次查询时间
        self.boardfile = os.path.join(moddir, "board_snapshot.json")  # mod 写：当前房间累计榜快照(只读)
        self.worldfile = os.path.join(moddir, "world_board.json")     # 这里写：世界总榜(mod 页签读)
        self.server, self.token = _cloud_cfg(moddir)            # cloud.json→退 cloud.default.json→环境变量覆盖
        self.server = _prefer_https(self.server)                 # 我们自己的服务器优先走 HTTPS 8771（证书钉在代码里）
        self.room_secret = ""                                    # 房间级上报密钥（授权应答带回，只有绑定机拿得到）
        try:                                                    # 世界榜上报间隔：cloud.json {"board_interval":秒}
            self.board_interval = max(60, int(_cloud_cfg_dict(moddir).get("board_interval") or 300))
        except Exception:
            self.board_interval = 300
        # 主播资料(run_room 认出主播后经 set_anchor 喂进来)：卡密心跳带上它，后台管理器才看得见「谁在用」。
        #   ★只有主播本人的公开昵称/头像URL + mod 版本号，绝不含观众数据/Windows 用户名。
        self.anchor_name = ""
        self.anchor_avatar = ""
        self._avatars = None             # run_room 经 attach_avatars 喂进来，给世界榜补观众头像 URL
        self._anchor_dirty = False       # 认出主播后置位 → 云端循环下一拍立刻补发心跳(不用干等30分钟)
        self._dl_started = set()         # 已开始后台下载的版本号(同版本别重复起线程)

    def attach_avatars(self, avatars):
        """★把 AvatarCache 挂进来，给世界榜补观众头像 URL。

        为什么需要这一步：`AvatarCache` 是 run_room 里的**局部变量**，而 Cloud 是另一个独立对象——
        两者原本互相看不见。世界榜的头像因此一直是空的(见 report_board 里的详细说明)。
        照搬隔壁 set_anchor 的路数：run_room 建好对象后喂进来。"""
        self._avatars = avatars

    def avatar_url_of(self, nick):
        """按【完整昵称】查这位观众已下载头像的原始 URL；查不到给 ""。
           ★口径必须对得上：AvatarCache._done 的 key 是 `" ".join(nick.split())` 归一化过、**没截断**的完整昵称。"""
        a = getattr(self, "_avatars", None)
        if a is None:
            return ""
        try:
            with a._lock:
                return str(a._done.get(nick) or "")
        except Exception:
            return ""

    def set_anchor(self, name, avatar=None):
        """run_room 的 on_anchor 回调喂进来主播昵称+头像 URL；变了就标脏，让卡密心跳尽快带给服务器。"""
        name = " ".join(str(name or "").split())
        avatar = str(avatar or "").strip()
        changed = False
        if name and name != self.anchor_name:
            self.anchor_name = name
            changed = True
        if avatar and avatar != self.anchor_avatar:
            self.anchor_avatar = avatar
            changed = True
        if changed:
            self._anchor_dirty = True

    @property
    def enabled(self):
        return bool(self.server)

    def _fallback_http(self, e):
        """HTTPS 连接层失败一次 → 本进程剩余时间退回 http（服务器同进程两个监听，https 挂了 http 多半也挂，但别把主播锁在门外）"""
        if self.server == _SERVER_HTTPS and _is_conn_error(e):
            log("服务器 HTTPS 连不上(%s)，本次会话退回 http" % type(e).__name__)
            self.server = _SERVER_HTTP
            return True
        return False

    def _post(self, path, payload, timeout=8):
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        for attempt in (1, 2):
            req = urllib.request.Request(self.server + path, data=data,
                                         headers={"Content-Type": "application/json"})
            try:
                with _urlopen(req, timeout) as r:      # 长轮询(/api/license/wait)传大 timeout 挂住
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:
                if attempt == 1 and self._fallback_http(e):
                    continue
                raise

    def _get(self, path):
        for attempt in (1, 2):
            try:
                with _urlopen(self.server + path, 8) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:
                if attempt == 1 and self._fallback_http(e):
                    continue
                raise

    def report_scores(self):
        """读 config.json 每位观众的送礼总分，与上次快照比，只上报增量。没令牌就不报。"""
        if not self.token:
            return
        cfg = _read_json(self.config, {})
        viewers = cfg.get("Viewers") or {}
        prev = _read_json(self.state, {})
        deltas, snapshot = [], {}
        for key, st in viewers.items():
            if not isinstance(st, dict):
                continue
            nick = (st.get("Nick") or key or "").strip()
            if not nick:
                continue
            total = int(((st.get("Score") or {}).get("Total")) or 0)
            snapshot[nick] = total
            add = total - int(prev.get(nick, 0))
            if add > 0:
                deltas.append([nick[:32], add])
        if not deltas:
            return
        try:
            self._post("/api/score", {"room": self.room, "s": self.token, "d": deltas, "secret": self.room_secret})
            with open(self.state, "w", encoding="utf-8") as f:
                json.dump(snapshot, f, ensure_ascii=False, separators=(",", ":"))
        except Exception as e:
            log("云端上报失败(不影响游戏): %r" % e)

    def check_update(self, bridge):
        """查服务器版本清单，比本地新就往事件桥写一行 update(格式固定：`update <版本> | <下载URL> | <一句话说明>`，
           mod 侧 Bridge.cs 按 | 切三段)，mod 只提示、绝不自动装。
           清单里有 download_url(安装包直链)时 → 后台线程把新安装包自动下到「下载\\WheelLive更新\\v<版本>\\」，
           断点续传、失败容忍(下一轮再续)，绝不阻塞直播主流程。"""
        # ★返回值(2026-07-16 补)：有起下载线程就把它交出去，好让一次性 --checkupdate 能 join。
        #   常驻连接器忽略返回值即可(绝不能 join，会堵住 45s 的上报拍子)。
        # ★服务器 /api/manifest 只有轮椅 mod 的安装包。别的游戏（DON'T SCREAM / 图书管理员）由客户端游戏库负责更新，
        #   这里若不拦，会把 200 多 MB 的轮椅安装包下到主播机器上、还往 UE mod 的 bridge 里写 updready。
        if self.game != "4wheel-challenge":
            return None
        try:
            m = self._get("/api/manifest")
        except Exception as e:
            log("云端查更新失败(不影响游戏): %r" % e)
            return None
        ver = str(m.get("version", "0.0.0"))
        if not _newer(ver, self.local_version):
            return None
        dl = str(m.get("download_url") or "").strip()            # 安装包直链(才自动下载)
        url = dl or str(m.get("url") or "").strip()              # 桥行展示：直链优先，退下载页链接
        notes = " ".join(str(m.get("notes") or "").split())      # 单行化：桥按行读，说明里的换行会截断事件行
        bridge.send("update %s | %s | %s" % (ver, url, notes))
        log("=" * 58)
        log("★★ 发现新版本 v%s（本机 v%s）" % (ver, self.local_version))
        if notes:
            log("★★ 更新内容: %s" % notes[:300])
        if url:
            log("★★ 下载地址: %s" % url)
        log("=" * 58)
        if dl.startswith("http"):                # ★只有明确的安装包直链才自动下；下载页链接(url)只展示不下载
            return self._start_download(ver, dl, bridge)
        return None

    def _start_download(self, ver, url, bridge=None):
        """同一版本只起一个后台下载线程；失败会把版本号从已启动集合里拿掉，下一轮 check_update 自动续传重试。
           ★返回这个线程(2026-07-16 补)：常驻连接器照旧不管它，但【一次性 --checkupdate】必须能 join 上 ——
             见 run_checkupdate 里那段注释：不 join 的话线程刚起就被解释器退出杀掉，安装包一个字节都下不完。"""
        if ver in self._dl_started:
            return None
        self._dl_started.add(ver)
        t = threading.Thread(target=self._download_installer, args=(ver, url, bridge), daemon=True)
        t.start()
        return t

    def _download_installer(self, ver, url, bridge=None):
        """后台把新版安装包下到 %USERPROFILE%\\Downloads\\WheelLive更新\\v<版本>\\。
           · 断点续传：写 .part 临时文件，重试时带 Range 头接着下(服务器不支持 206 就重头)；
           · 下完原子改名成正式文件——目录里看到的 exe 一定是完整的；
           · 任何失败只记日志绝不抛出(daemon 线程,不影响直播)。"""
        dest_dir = os.path.join(os.path.expanduser("~"), "Downloads", "WheelLive更新", "v" + ver)
        try:
            os.makedirs(dest_dir, exist_ok=True)
            name = os.path.basename(urllib.parse.urlparse(url).path)
            try:
                name = urllib.parse.unquote(name)
            except Exception:
                pass
            if not name or "." not in name:
                name = "WheelLive_v%s_安装程序.exe" % ver
            final = os.path.join(dest_dir, name)
            if os.path.isfile(final) and os.path.getsize(final) > 0:
                log("新版安装包之前已下好: %s" % final)
                self._announce_ready(ver, final, bridge)   # ★上次下好的也要报，不然重开游戏后 mod 又不知道包在哪
                return
            part = final + ".part"
            pos = os.path.getsize(part) if os.path.isfile(part) else 0
            headers = {"User-Agent": "WheelLiveConnector/" + self.local_version}
            if pos > 0:
                headers["Range"] = "bytes=%d-" % pos
            req = urllib.request.Request(url, headers=headers)
            mode = "ab"
            with _urlopen(req, 30) as r:
                if pos > 0 and r.getcode() != 206:
                    mode = "wb"                      # 服务器不支持断点续传 → 重头下
                with open(part, mode) as f:
                    while True:
                        chunk = r.read(256 * 1024)
                        if not chunk:
                            break
                        f.write(chunk)
            os.replace(part, final)
            log("★★ 新版 v%s 安装包已下好: %s" % (ver, final))
            self._announce_ready(ver, final, bridge)
        except Exception as e:
            log("安装包后台下载失败(不影响直播,下一轮自动续传): %r" % e)
            self._dl_started.discard(ver)

    def _announce_ready(self, ver, path, bridge):
        """★往事件桥写 `updready <版本> | <安装包绝对路径>`。
           用户 2026-07-15 反馈：「居然不是内置更新，是去下了一个安装包再更新的」——
           根因就是这一步以前【没有】：包早就默默下好了，但 mod 完全不知道它在哪，
           于是 F1 里那个按钮只能「打开浏览器让你再下一遍」。报了路径，mod 才能一键装。"""
        if bridge is None:
            return
        try:
            bridge.send("updready %s | %s" % (ver, path))
        except Exception as e:
            log("updready 上报失败(不影响下载): %r" % e)

    def _current_email(self):
        """当前登录邮箱（客户端写 email_account.json；没登录返回空）。"""
        try:
            acc = _read_json(self.emailfile, None)
            return str((acc or {}).get("email") or "").strip()
        except Exception:
            return ""

    def heartbeat_body(self):
        """卡密心跳请求体：直播间号 + 主播公开资料(昵称/头像URL) + mod 版本号 + 机器码 + 当前登录邮箱。
           ★这是软件作者自己的运营数据上报(后台看「谁在用」)，只发往他自己的服务器；
             绝不含观众数据/Windows 用户名。没认出主播时 anchor_* 为空串。
           machine_id=注册表 MachineGuid(退 MAC)，服务器用它签「单许可单机」的 license_blob。
           email 用于服务器兜底记录「邮箱↔直播间」绑定(后台邮箱账号表显示)。"""
        return {"room": self.room,
                "anchor_name": (self.anchor_name or "")[:64],
                "anchor_avatar": (self.anchor_avatar or "")[:500],
                "version": (self.local_version or "")[:20],
                "machine_id": machine_id(),
                "email": self._current_email()[:100]}

    def check_license(self):
        """卡密心跳(慢轮询兜底)：POST 心跳体(谁在用)给服务器取回本直播间授权态，落 license_status.json 给 mod 读。
           ★即时解锁走独立的 license_waiter 长轮询线程；这里保留作「启动首拍」+「老服务器/长轮询断线时」的兜底。
           老版服务器没有 POST /api/license 时(404/405)自动退回旧 GET 只查不报——升级顺序无所谓。
           查询失败/没连真直播间就不写——mod 读不到=不锁，绝不误伤。"""
        if not self.room or self.room == "default":
            return                                # 没连真直播间(--sim/无号)不查不报
        r = None
        try:
            r = self._post("/api/license", self.heartbeat_body())
        except urllib.error.HTTPError as e:
            if e.code not in (404, 405):          # 404/405=老服务器没有 POST → 走下面 GET 兜底
                log("卡密心跳失败(不影响游戏): %r" % e)
                return
        except Exception as e:
            log("卡密心跳失败(不影响游戏): %r" % e)
            return
        if r is None:
            try:
                r = self._get("/api/license?room=" + urllib.parse.quote(self.room))
            except Exception as e:
                log("卡密查询失败(不影响游戏): %r" % e)
                return
        self._write_lic_status(r)

    def _replace_retry(self, tmp, dst):
        """os.replace 原子替换。Windows 上若 mod 正好在读同名文件，替换会 PermissionError(拒绝访问)——
           极短退避重试几次即可成功(mod 每 3s 只读几毫秒)，保证这一拍状态不丢；真失败才抛给上层记日志(非致命)。"""
        for i in range(5):
            try:
                os.replace(tmp, dst)
                return
            except PermissionError:
                if i == 4:
                    raise
                time.sleep(0.03)

    def _email_licensed(self):
        """邮箱购买授权并入：客户端登录后写 email_account.json，这里查服务器 /api/email/license，
           邮箱已购买(licensed=1) 或 已开通本游戏(games 含 GAME_ID) 且未封禁 → 返回 1，
           合并进 license_status.json 的 licensed 给 mod 显示「已授权」。
           60s 缓存；没邮箱账号 / 服务器还没这个模块(404) / 查询失败 → 一律返回 0，绝不影响原卡密逻辑。"""
        try:
            acc = _read_json(self.emailfile, None)
            email = str((acc or {}).get("email") or "").strip()
            if not email:
                self._email_lic = 0
                return 0
            now = time.time()
            if email == self._email_lic_email and now - self._email_lic_at < 60:
                return self._email_lic
            try:
                r = self._post("/api/email/license", {"email": email}, timeout=5)
                if isinstance(r, dict) and int(r.get("banned") or 0) == 0:
                    # games 已是服务器过滤后的有效授权映射（老结构 {game:1} 也兼容）；
                    # 含 GAME_ID 即该游戏已授权且未到期，服务器已把过期/收回的滤掉。
                    lic = 1 if (int(r.get("licensed") or 0) == 1
                                or bool((r.get("games") or {}).get(GAME_ID))) else 0
                else:
                    lic = 0
            except Exception as e:
                log("邮箱授权查询失败(不影响游戏): %r" % e)
                lic = 0
            self._email_lic = lic
            self._email_lic_email = email
            self._email_lic_at = now
            return lic
        except Exception:
            return 0

    def _write_lic_status(self, r):
        """把服务器授权应答 r 原子落地成 license_status.json 给 mod 读(慢轮询 check_license 与长轮询 license_waiter 共用)。
           r 无效/ok!=1 → 不动文件(mod 读旧值或读不到，绝不误伤付费用户)。mod 侧 3s 惰性重读它显示/强锁。"""
        try:
            if not isinstance(r, dict) or not r.get("ok"):
                return
            with self._lic_lock:                     # ★串行化 license_status.json 的读-改-写(loop/waiter/apply 三处写互斥)，防 .tmp 撞车+apply 丢更新
                out = {"room": self.room,
                       "licensed": int(r.get("licensed") or 0),
                       "banned": int(r.get("banned") or 0),   # 封禁信号透传(mod 见 banned=1 直接锁,不再给缓存兜底)
                       "expire": str(r.get("expire") or "")[:10],
                       "note": str(r.get("note") or "")[:60],
                       "checked": int(time.time()),
                       "machine_id": machine_id()}       # 本机机器码(mod C# 拿它和 blob 里的比对)
                if self._email_licensed():                # 邮箱购买授权并入：卡密 OR 邮箱，任一个授权都算
                    out["licensed"] = 1
                blob = str(r.get("license_blob") or "")  # RSA 签名许可证(服务器按 room+machine_id 现签)
                if blob:
                    out["blob"] = blob[:4096]            # 老服务器/未授权没有 blob → 字段省略(C# 兼容读)
                sec = str(r.get("secret") or "")[:64]    # 房间级上报密钥：只在签发成功的应答里带，内存持有不落盘
                if sec:
                    self.room_secret = sec
                try:
                    srv_t = int(r.get("srv_time") or 0)  # 服务器时间(mod 侧防调表参考)，老服务器没有就省略
                except Exception:
                    srv_t = 0
                if srv_t:
                    out["srv_time"] = srv_t
                if not out["licensed"]:                  # 已提交购买申请的标记：授权没批下来前保留给 mod 显示
                    prev = _read_json(self.licfile, None)
                    if isinstance(prev, dict) and prev.get("apply"):
                        out["apply"] = str(prev.get("apply"))[:16]
                tmp = self.licfile + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
                self._replace_retry(tmp, self.licfile)
        except Exception as e:
            log("卡密状态落盘失败(不影响游戏): %r" % e)

    def license_waiter(self, stop):
        """★即时解锁·长轮询线程：挂住 /api/license/wait，作者一批准/续期/封禁，服务器立刻应答 → 秒级写 license_status.json，
           mod 3s 内解锁/锁定(不用干等 30 分钟慢轮询)。
           · since=上次拿到的授权态签名；态没变服务器最多挂 25s 空返回，客户端无缝重挂(稳态≈每 25s 一次，几乎零流量)。
           · 老服务器没有这个接口(404/405) → 线程退场，主循环 30 分钟慢轮询照常兜底(升级顺序无所谓)。
           · 网络抖动/超时/连不上 → 退避后重挂，绝不忙等；一切异常只记日志，绝不抛出影响直播。"""
        since = ""
        miss = 0
        while not stop.is_set():
            if not self.room or self.room == "default":
                stop.wait(15)                    # 没连真直播间：歇会儿再看(连上后自然进入长轮询)
                continue
            try:
                body = self.heartbeat_body()
                body["since"] = since
                r = self._post("/api/license/wait", body, timeout=35)   # 服务器最多挂 25s，客户端留足余量
            except urllib.error.HTTPError as e:
                if e.code in (404, 405):         # 老服务器没有长轮询接口 → 退场，靠慢轮询兜底
                    log("服务器暂不支持即时解锁长轮询——靠常规心跳兜底(不影响使用)。")
                    return
                miss += 1
                stop.wait(min(30, 3 + miss * 3))
                continue
            except Exception:
                miss += 1                        # 超时/连不上：指数退避重挂，别忙等
                stop.wait(min(30, 3 + miss * 3))
                continue
            miss = 0
            if not isinstance(r, dict) or not r.get("ok"):
                stop.wait(8)
                continue
            self._write_lic_status(r)            # 授权态可能刚变(changed=1)或到点空返回(changed=0)，都刷一遍最新态
            since = str(r.get("sig") or since)[:160]
            # since 已更新 → 态没变时服务器会稳稳挂满 25s(不热轮询)；态一变立刻返回→这里立即重挂等下一次变化。

    def _mark_apply_sent(self):
        """在 license_status.json 里加 "apply":"sent"(其余字段原样保留)——mod F1 面板据此显示「已申请，等待审批」。"""
        try:
            with self._lic_lock:                     # ★同一把锁：和 _write_lic_status 串行，防 apply 标记被并发写覆盖丢失
                st = _read_json(self.licfile, None)
                if not isinstance(st, dict):
                    st = {"room": self.room}
                st["apply"] = "sent"
                tmp = self.licfile + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(st, f, ensure_ascii=False, separators=(",", ":"))
                self._replace_retry(tmp, self.licfile)
        except Exception as e:
            log("申请标记落盘失败: %r" % e)

    def check_apply(self):
        """桥外「申请购买」通道：mod C#(F1 面板按钮)往 Mods\\WheelLive\\apply_request.json 写 {room,note}，
           这里每拍检查：存在 → POST /api/license/apply(带 machine_id+anchor_name)；
           成功删文件并在 license_status.json 标 "apply":"sent"；发送失败保留文件下拍重试。
           ★切记不是每次都要申请——已授权的房间服务器直接回 already=1，永远不进待审批。"""
        try:
            if not os.path.isfile(self.applyfile):
                return
        except Exception:
            return
        req = _read_json(self.applyfile, None)
        if not isinstance(req, dict):
            try:
                os.remove(self.applyfile)            # 坏文件删掉，别永远卡在重试
            except Exception:
                pass
            return
        room = str(req.get("room") or self.room or "").strip()[:64]
        if not room or room == "default":
            log("申请文件缺直播间号，无法代发——已删除(请在 F1 面板填好直播间号再点申请)。")
            try:
                os.remove(self.applyfile)
            except Exception:
                pass
            return
        body = {"room": room,
                "anchor_name": (self.anchor_name or "")[:64],
                "machine_id": machine_id(),
                "note": " ".join(str(req.get("note") or "").split())[:100]}
        try:
            r = self._post("/api/license/apply", body)
        except Exception as e:
            log("购买申请发送失败(下一拍重试): %r" % e)
            return                                   # 文件保留 → 下拍自动重试
        try:
            os.remove(self.applyfile)                # 服务器已应答(不管批没批)→本次申请闭环，删除请求文件
        except Exception:
            pass
        if r.get("ok"):
            self._mark_apply_sent()
            if r.get("already"):
                log("购买申请：房间 %s 已有授权，无需申请。" % room)
            else:
                log("购买申请已提交(房间 %s)——等作者审批，批准后几秒内自动解锁(无需重启)。" % room)
        else:
            log("购买申请被服务器拒绝: %s" % str(r.get("err") or "?"))

    def _apply_watcher(self, stop):
        """申请代发独立短周期线程(v0.9.19)：每 2s 查一次 apply_request.json，有就立刻 POST 代发——
           主 loop 的 45s 拍太慢，用户点「申请购买」后干等很久界面才变「已提交」。
           和 license_waiter 一样纯 daemon，绝不阻塞直播主流程；一切异常都交给 check_apply 内部兜住。"""
        while not stop.is_set():
            try:
                self.check_apply()
            except Exception:
                pass
            stop.wait(2.0)

    def report_board(self):
        """云端世界总榜：mod C# 把当前累计榜写 board_snapshot.json({room,viewers:[{nick,score,avatar}]},
           avatar 是公开 CDN URL)，这里每 board_interval 秒(默认300)清洗后上报 top30；随后拉世界榜写
           world_board.json({"ts","world","room_total"}，UTF-8 无 BOM)给 mod 页签读。
           快照文件不存在/坏 → 只拉不报；一切失败只记日志绝不影响直播。"""
        if not self.room or self.room == "default":
            return                                   # 没连真直播间不报不拉
        snap = _read_json(self.boardfile, None)
        if isinstance(snap, dict) and isinstance(snap.get("viewers"), list):
            room = str(snap.get("room") or self.room).strip()[:64] or self.room
            # ★主播是谁 —— 【只兜底，绝不覆盖爬到的】mod F1 手填昵称，随快照捎带上来。
            #   ★★2026-07-16 实测更正(别再信我之前那句话)：爬取 `douyin_room._emit_anchor` **是好的**。
            #     线上 3 个房间有 2 个昵称+头像**都爬到了**(「幸存者626」「哈喽永远喜欢鲸落哥哥」，
            #     头像也是真的 douyinpic.com URL)；唯一空的那个是还在跑 **v0.9.13** 的老客户端 ——
            #     那个版本压根没有主播心跳这功能，跟爬取好不好没关系。
            #   → 所以这里必须是 `if not self.anchor_name`：**爬到的才是权威**(抖音那边的真名/真头像)；
            #     手填的只是主播自己在 F1 里随手输的显示名，可能是旧的、可能就是个外号。
            #     无条件 set_anchor 会把爬到的真名顶掉 = 把好好的东西改坏。
            #   那手填这条留着干嘛：抖音一改版，爬取会**静默**失效(这是它的老毛病)，
            #     那时候至少后台还认得出人是谁，而不是又变回一串房号。
            if not self.anchor_name:
                self.set_anchor(str(snap.get("anchor") or ""))
            viewers = []
            for v in snap["viewers"]:
                if not isinstance(v, dict):
                    continue
                full = " ".join(str(v.get("nick") or "").split())   # ★完整昵称：查头像要用它
                nick = full[:32]                                    # 上报用的截断名(服务端也按 32 截)
                try:
                    score = int(v.get("score") or 0)
                except Exception:
                    continue
                if not nick or score <= 0:
                    continue
                av = str(v.get("avatar") or "").strip()[:500]
                # ★★世界榜头像修复(2026-07-15)：在这之前世界榜的头像【从出生就是空的，0% 可用】。
                #   根因是两边都以为对方补：mod 的 WorldBoard.cs 硬写 "avatar":""，注释说"连接器那边有 URL 自己补"；
                #   而这里是【原样透传】—— 输入 "" → startswith("http") 为 False → 输出还是 ""。谁都没补。
                #   现在真的补上：连接器自己就有 AvatarCache._done(昵称→URL)，它下载时本来就拿到了 URL。
                # ★必须用【未截断】的 full 去查：_done 的 key 没截断，用 nick[:32] 查的话，
                #   超过 32 字的昵称(带 emoji 的真实用户很常见)会全部查不中，等于白修。
                if not av.startswith("http"):
                    av = self.avatar_url_of(full)[:500]
                row = {"nick": nick, "score": score,
                       "avatar": av if av.startswith("http") else ""}
                # ★★★这里曾经是【整条管线的断点】(2026-07-16)：
                #   老代码这一行是写死的三键 dict，mod 传上来的 m(6 维度 × 4 时间窗)【在这里被整个扔掉】。
                #   也就是说：mod 改了、服务端改了、后台改了，全都白改 —— 数据走不出连接器这道门。
                #   而且不报错、不掉线、榜单照常显示，只是永远只有送礼分那一个维度。
                #   ★教训：「三处 schema」是照着 mod+服务端数的，漏了【中间的连接器】。
                #     以后凡是加字段，必须把 mod→连接器→服务端→后台 四段【全部】走一遍。
                # ★v1.0：4 窗 → 5 窗(加「本年」，线上序 0今日 1本周 2本月 3总 **4本年**，只能追加不能重排)。
                #   这里漏改 = mod 发 5 格、连接器砍回 4 格 → 本年在【中间这道门】原地蒸发，
                #   而且服务端补零后看着像"本年就是没数据"，一点报错都没有 —— 正是上面那段注释说的老坑重演。
                m = v.get("m")
                if isinstance(m, list) and m:
                    clean = []
                    for arr in m[:8]:
                        if not isinstance(arr, list):
                            clean.append([0.0] * WINDOWS)
                            continue
                        w = []
                        for x in arr[:WINDOWS]:
                            try:
                                f = float(x)
                            except Exception:
                                f = 0.0
                            if f != f or f in (float("inf"), float("-inf")):
                                f = 0.0
                            w.append(round(max(0.0, min(1e9, f)), 2))
                        while len(w) < WINDOWS:
                            w.append(0.0)
                        clean.append(w)
                    row["m"] = clean
                viewers.append(row)

            # ★★另一处静默丢：老代码是 `viewers.sort(-score)[:30]`。
            #   mod 那边费劲取了 24 个榜的【并集】发过来，到这里【又被按送礼分砍回 30】——
            #   飞天王送礼分垫底，第一个被砍掉，飞天榜永远是空的。
            #   规则和服务端一致：top30(按送礼分，=老行为) ∪ 每个(维度,时间窗)的 top10，封顶 60。
            def _mval(v, metric, window):
                mm = v.get("m")
                if isinstance(mm, list) and 0 <= metric < len(mm):
                    a = mm[metric]
                    return float(a[window]) if isinstance(a, list) and 0 <= window < len(a) else 0.0
                return float(v.get("score") or 0) if (metric == 4 and window == 3) else 0.0

            keep, order = set(), []

            def _keep(v):
                if v["nick"] not in keep and len(keep) < 60:
                    keep.add(v["nick"])
                    order.append(v)

            for v in sorted(viewers, key=lambda x: -x["score"])[:30]:
                _keep(v)
            for metric in range(8):
                for window in range(WINDOWS):   # ★v1.0 4→5：漏了本年这格，「本年王」会被上面 top30 那刀砍掉
                    ranked = [v for v in viewers if _mval(v, metric, window) > 0]
                    ranked.sort(key=lambda x: -_mval(x, metric, window))
                    for v in ranked[:10]:
                        _keep(v)
            viewers = sorted(order, key=lambda x: -x["score"])

            # ★空榜也要报：新主播刚开播、还没收到礼物时 viewers 就是空的，
            #   而这恰恰是最该在后台看见的人。服务端见 viewers=[] 会保榜只更新主播/时间。
            if viewers or self.anchor_name:
                try:
                    self._post("/api/board", {"room": room, "viewers": viewers,
                                              "v": self.local_version or "",
                                              "game": self.game,
                                              "anchor": self.anchor_name or "",
                                              "secret": self.room_secret})
                except Exception as e:
                    log("世界榜上报失败(不影响游戏): %r" % e)
        # ★v1.0：先按老路拿「送礼分·总」那一格(world/room_total 两个老键，mod 侧老代码就认这两个)。
        try:
            r = self._get("/api/board?room=" + urllib.parse.quote(self.room))
        except Exception as e:
            log("世界榜拉取失败(不影响游戏): %r" % e)
            return
        if not isinstance(r, dict) or not r.get("ok"):
            return                                   # 老服务器的旧 /api/board 没有 ok/world 字段 → 不落盘
        out = {"ts": int(time.time()),
               "world": r.get("world") or [],
               "room_total": r.get("room_total") or []}
        # ★再多拉一次 grid=1，把 6 维度 × 5 时间窗 = 30 格一次取回，喂给「每个时间窗下切本直播间/世界」。
        #   ★为什么【额外】拉而不是替换掉上面那次：老服务器不认 grid 参数，会当成普通请求返回单格数据 →
        #     我们这里认 `grid==1` 才收，认不出就当没有。这样【新连接器 + 老服务器】仍然能工作(只是没有 30 格)，
        #     而不是把世界榜整个搞哑。多一次请求 5 分钟一回，代价可以忽略。
        try:
            g = self._get("/api/board?grid=1&room=" + urllib.parse.quote(self.room))
            if isinstance(g, dict) and g.get("grid") == 1 and isinstance(g.get("cells"), dict):
                out["cells"] = g["cells"]
        except Exception as e:
            log("世界榜 grid 拉取失败(不影响老榜显示): %r" % e)
        try:
            tmp = self.worldfile + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:   # UTF-8 无 BOM(json.dump 本来就不写 BOM)
                json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, self.worldfile)
        except Exception as e:
            log("世界榜落盘失败: %r" % e)

    def report_errors(self):
        """把 error_queue.jsonl 里攒的错误记录回传服务器(开发者远程排障用)。
           流程：先把整个队列文件原子改名成 error_upload.tmp「挪走」——写入方(mod/本进程)下一条错误
           会自然重建队列文件，两边绝不互相踩；回传成功删 tmp，失败留着下轮续传。每次最多 50 条。"""
        qf = os.path.join(self.moddir, "error_queue.jsonl")
        tf = os.path.join(self.moddir, "error_upload.tmp")
        try:
            if not os.path.isfile(tf):
                if not os.path.isfile(qf) or os.path.getsize(qf) == 0:
                    return
                os.replace(qf, tf)
            with open(tf, "r", encoding="utf-8", errors="replace") as f:
                lines = f.read().splitlines()
        except Exception:
            return
        entries = []
        for ln in lines[:50]:
            ln = ln.strip()
            if not ln:
                continue
            try:
                it = json.loads(ln)
                if isinstance(it, dict):
                    entries.append(it)
            except Exception:
                entries.append({"tag": "raw", "msg": ln[:300]})
        if not entries:
            try: os.remove(tf)
            except Exception: pass
            return
        try:
            # ★不带 room：设置页承诺错误回传「不含直播间号/观众数据」，payload 只有版本号+错误条目。
            self._post("/api/error", {"v": self.local_version, "e": entries})
            rest = [ln for ln in lines[50:] if ln.strip()]
            if rest:
                with open(tf, "w", encoding="utf-8") as f:
                    f.write("\n".join(rest) + "\n")
            else:
                os.remove(tf)
            log("已回传 %d 条错误报告(帮开发者远程修 bug)" % len(entries))
        except Exception as e:
            log("错误报告回传失败(不影响游戏,下轮再试): %r" % e)

    def start(self, bridge, stop):
        if not self.enabled:
            log("卡密由客户端管理，旧授权与上报服务未连接。" if os.environ.get("ZL_CARD_MODE") == "1" else "云端功能关闭(cloud.json 未配 server)——不联网。")
            return None

        def loop():
            self.check_update(bridge)              # 启动先查一次更新
            self.check_license()                   # 启动报一次卡密心跳(写 license_status.json 给 mod 显示)
            last_upd = time.time()
            last_lic = time.time()
            last_err = 0.0                         # 错误回传：启动先试一轮，之后每 5 分钟
            last_board = 0.0                       # 世界总榜：启动先来一轮(先把世界榜拉给 mod 页签)，之后每 board_interval 秒
            while not stop.is_set():
                self.report_scores()               # 每 45s 报一次增量
                # ★v0.9.16：原来是「启动查一次，之后每 6 小时」——实测这就是「推了新版但别的用户收不到通知」的真凶：
                #   推送时正在直播的人，连接器早就跑起来了，最坏要干等 6 小时才回头看一眼清单。
                #   查清单只是一个几百字节的 GET，20 分钟一次的开销可以忽略，紧急修复能当天铺开。
                if time.time() - last_upd > UPDATE_POLL_SEC:
                    self.check_update(bridge)
                    last_upd = time.time()
                # 每 30 分钟一拍卡密心跳(开通/续期无需重启即生效)；刚认出主播(标脏)时提前补一拍，
                # 让后台管理器尽快看到主播名/头像，不用干等半小时。
                if self._anchor_dirty or time.time() - last_lic > 1800:
                    self._anchor_dirty = False
                    self.check_license()
                    last_lic = time.time()
                if time.time() - last_err > 300:
                    self.report_errors()
                    last_err = time.time()
                if time.time() - last_board > self.board_interval:   # 世界总榜：上报快照+拉世界榜落盘
                    self.report_board()
                    last_board = time.time()
                stop.wait(45)

        t = threading.Thread(target=loop, daemon=True)
        t.start()
        # ★断档礼物补发(2026-08-09)：独立 1.6s 快线程——45s 主拍太慢,「进房后继续出票」要有节奏地一条条来。
        #   tick_pending 内部自带 _replay_next 节流+「不在房不发」闸,这里只是驱动。
        def pend_loop():
            while not stop.is_set():
                try: bridge.tick_pending()
                except Exception: pass
                stop.wait(1.6)
        tp = threading.Thread(target=pend_loop, daemon=True)
        tp.start()
        # ★即时解锁：独立长轮询线程，作者一审批服务器立刻应答→秒级解锁(老服务器没这接口会自动退场，慢轮询兜底)。
        tw = threading.Thread(target=self.license_waiter, args=(stop,), daemon=True)
        tw.start()
        # ★申请短周期代发(v0.9.19)：mod 点「申请购买」写 apply_request.json 后 2 秒内就代发——
        #   不再挤在 45 秒主拍里(用户反馈「点申请提交很久才过去」)。文件检查只是 isfile，便宜。
        ta = threading.Thread(target=self._apply_watcher, args=(stop,), daemon=True)
        ta.start()
        log("云端已启动: %s（总分上报: %s / 版本推送: 开 / 即时解锁: 开 / 申请代发: 2s）" %
            (self.server, "开" if self.token else "关·本机无令牌"))
        return t



def run_installupdate(setup_exe, game_dir, bridge_path="", relaunched=False):
    """★一次性「内置更新」执行器（用户 2026-07-15 反馈：「居然不是内置更新，是去下了一个安装包再更新的欸」）。
       mod 里点「立即更新」→ 拉起本进程 → mod 随即 Application.Quit()。本进程接着：
         ① 等游戏进程真的退干净（不等的话 WheelLive.dll 还被占着，Inno 会弹「文件正在使用」把静默装打断）；
         ② /VERYSILENT 静默装到原游戏目录（安装包只补程序，配置一律 onlyifdoesntexist，设置/榜单/累计全保留）；
         ③ 装完把游戏从 Steam 拉回来，主播回到桌面时游戏已经是新版了。
       任何一步失败都只记日志 + 把安装包目录打开让主播自己双击 —— 绝不把人晾在"游戏关了、新版没装上"的坑里。"""
    # ★把日志落到安装包旁边(见 log() 里那段注释)：这是唯一在游戏死后执行的代码，
    #   不落盘 = 出了事一条线索都没有。★必须在第一条 log 之前设，否则开头几行丢了。
    try:
        _LOGF[0] = os.path.join(os.path.dirname(os.path.abspath(setup_exe)), "update_log.txt")
    except Exception:
        pass
    log("=" * 58)
    log("★ 内置更新开始: %s (relaunched=%s)" % (setup_exe, relaunched))
    if not os.path.isfile(setup_exe):
        log("！安装包不见了，放弃: %s" % setup_exe)
        return 3          # ★非 0：让 mod 侧的秒退闸门看见「没接手」，别关游戏(见下面退出码约定)

    # ★★①.5 躲开「拿要被覆盖的 python 去装覆盖它自己的包」(2026-07-16)
    #   已核实(不是推测)：WheelLive.iss 的 [Files] 里
    #     `Source: "{#PayloadDir}\Mods\WheelLive\*" ... Excludes: "config.json,cloud.json,…"` —— 那串 Excludes 里【没有 pyembed】，
    #   注释自己也写着「DLL + 全部素材 + **内置 pyembed**」；而 Connector.PythonExes(mod/Connector.cs) 【优先】用
    #   `Mods\WheelLive\pyembed\python.exe` → 执行安装的 exe，正是安装包要覆盖的 exe。
    #   Windows 上运行中的 .exe 和已加载的 .dll 是【锁死】的(OS 硬约束，不是猜)，配上 /SUPPRESSMSGBOXES，
    #   文件占用只会【静默 Abort】——主播看到的就是"游戏关了、装了个寂寞"。
    #   ★DLL 那把锁 .iss 已经用 taskkill 解决了，Python 这把从来没人管。
    #   → 把整个 pyembed 拷到 %TEMP% 再从那儿重新拉起自己，装的时候游戏目录里这份就没人用了。
    #   ★为什么整个拷、不排除 47MB 的 Lib：省那一下不值得赌"安装路径用不到 Lib 里的东西"——
    #     赌输了坏在【游戏已经关掉之后】，是最难查的位置。68MB 拷贝 1~2 秒，一次更新就一次，无所谓。
    if not relaunched:
        try:
            exe_dir = os.path.dirname(os.path.abspath(sys.executable))
            mod_dir = os.path.dirname(os.path.abspath(__file__))
            if exe_dir.lower().startswith(mod_dir.lower()):     # 正在用游戏目录里的 pyembed
                import shutil, tempfile
                tmp = os.path.join(tempfile.gettempdir(), "WheelLiveUpd")
                shutil.rmtree(tmp, ignore_errors=True)
                tmp_py = os.path.join(tmp, os.path.basename(exe_dir))
                log("拷贝 pyembed → %s（躲开自我覆盖）" % tmp_py)
                shutil.copytree(exe_dir, tmp_py)
                shutil.copy2(os.path.abspath(__file__), os.path.join(tmp, "connector.py"))
                cmd = [os.path.join(tmp_py, os.path.basename(sys.executable)),
                       os.path.join(tmp, "connector.py"),
                       "--installupdate", setup_exe, "--relaunched"]
                if game_dir:
                    cmd += ["--gamedir", game_dir]
                log("从临时目录重新拉起: %s" % " ".join(cmd))
                subprocess.Popen(cmd, creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
                                                    | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
                log("★ 交棒完成，本进程退出（真正的安装由临时目录那个进程做）")
                return 0    # ★退出码 0＝交棒成功。mod 侧闸门认【退出码】不认耗时——
                            #   这一步很可能 1.5s 内就退，若闸门按"秒退=失败"判，就会把成功的交棒误判成失败。
        except Exception as e:
            log("！拷贝/重拉失败(%r) —— 退回原地装，可能撞上 python 自锁" % e)

    # ①等游戏退干净(最多 60s)
    for i in range(120):
        if not _game_running():
            break
        time.sleep(0.5)
    else:
        log("！游戏 60s 还没退干净，仍继续尝试(Inno 可能会弹文件占用)")
    time.sleep(1.0)                                  # 再让句柄彻底释放一拍
    # ②静默装回原目录
    cmd = [setup_exe, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"]
    if game_dir:
        cmd.append("/DIR=" + game_dir)
    log("静默安装中: %s" % " ".join(cmd))
    try:
        rc = subprocess.call(cmd)
    except Exception as e:
        log("！安装失败: %r" % e)
        rc = -1
    if rc != 0:
        log("！安装返回 rc=%d —— 打开安装包目录，请手动双击一次" % rc)
        try:
            os.startfile(os.path.dirname(setup_exe))
        except Exception:
            pass
        return 4          # 走到这时游戏早关了、mod 也没了，退出码没人看——只为让日志和退出码自洽
    log("★ 安装完成，正在把游戏拉回来...")
    # ③把游戏开回来
    try:
        os.startfile("steam://rungameid/3504700")
    except Exception as e:
        log("！自动拉起游戏失败(手动开一下就行): %r" % e)
    log("★ 内置更新全部完成")
    log("=" * 58)
    return 0


def _game_running():
    """游戏进程还在不在(tasklist 比 psutil 稳，且不引入第三方依赖)。"""
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq 4Wheel Challenge.exe"],
                             capture_output=True, text=True, errors="replace",
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout or ""
        return "4Wheel Challenge.exe" in out
    except Exception as e:
        # ★★这就是【共犯本尊】。它以前是光秃秃的 `except: return False` ——
        #   `subprocess` 没 import → 这里抛 NameError → 被吞 → 谎报「游戏没在跑」→ 装更新的循环直接放行，
        #   而真正的元凶(run_installupdate 里同一个 NameError)在外层也被吞掉。**两层静默叠一起，
        #   内置更新连死五个版本(v0.9.13~0.9.17)，日志上一个字都没有。**
        #   现在 subprocess 补上了，但【形状还在】：下一个手滑照样能从这个洞漏出去。留一行日志堵住它。
        # ★仍然返回 False(继续往下装)是对的：查不到进程时硬等 60s 更没意义，Inno 撞上占用会自己报错。
        #   要补的从来不是默认值，是"为什么"。
        log("！查游戏进程失败(%r) —— 当作没在跑继续。若接着报文件占用，先看这行" % e)
        return False


def run_checkupdate(bridge_path, version):
    """一次性「立即检查新版本」执行器（F1 设置页的按钮拉起本进程干 HTTP，干完就退——游戏进程保持零联网）。
       ★这条路不需要连直播间：常驻连接器只有「填了直播间号并连上」才会跑，没开播的人原来根本没有任何查更新的途径
         (这正是「推了新版但别的用户收不到通知」的第三个原因)。这个按钮把查更新和开不开播彻底解耦。
       发现新版 → 复用 check_update 往事件桥写 `update ...` 行(mod 弹提示 + F1 横幅 + 后台下好安装包)；
       已是最新/出错 → 回一条 status，让主播看见「确实查过了」，而不是点了没反应。"""
    bridge = Bridge(bridge_path)
    moddir = os.path.dirname(os.path.abspath(bridge_path))
    cloud = Cloud(moddir, "manual", version)
    if not cloud.enabled:
        bridge.send("status 没配置云端地址，查不了更新(cloud.json 里 server 为空)")
        return
    try:
        m = cloud._get("/api/manifest")
    except Exception as e:
        log("手动查更新失败: %r" % e)
        bridge.send("status 查更新失败：连不上服务器，检查下网络再点一次")
        return
    ver = str(m.get("version", "0.0.0"))
    if _newer(ver, cloud.local_version):
        # ★★2026-07-16 修「点了『立即检查新版本』永远只出『去更新』、出不来『立即更新』」：
        #   check_update → _start_download 起的是 **daemon 线程**，起完就返回 → run_checkupdate 返回
        #   → main 返回 → 解释器退出 → **daemon 线程当场被杀** → 210MB 安装包连 DNS 都没跑完
        #   → 永远发不出 `updready` → mod 侧 Cloud.InstallerReady 永远为假 → 按钮永远是「去更新」。
        #   ＝用户原话「居然不是内置更新，是去下了一个安装包再更新的欸」在这条路上是【结构上必然】的。
        #   → 一次性进程必须【等它下完】再退。常驻连接器那条路(Cloud.start 的 loop)照旧不 join。
        bridge.send("status 发现新版 v%s，正在后台下载安装包…（大约 200MB，下好会自动提示）" % ver)
        t = cloud.check_update(bridge)
        if t:
            t.join()
        else:
            log("！没起下载线程(清单里没给 download_url 直链?) —— 只能走「去更新」手动下")
    else:
        # ★已是最新也要回报服务器版本号：mod 侧 Cloud.Announce 会自己比对(同版=不弹提示)，
        #   但能借此把「确实核对过了」记下来，设置页才敢写"已是最新(查过了)"而不是空口白话。
        dl = str(m.get("download_url") or "").strip()
        url = dl or str(m.get("url") or "").strip()
        notes = " ".join(str(m.get("notes") or "").split())
        bridge.send("update %s | %s | %s" % (ver, url, notes))
        bridge.send("status 已经是最新版 v%s，不用更新" % cloud.local_version)


def run_sharecmd(cmdfile, version):
    """一次性「云端分享」命令执行器（mod 拉起本进程干 HTTP，干完就退——游戏进程保持零联网）。
       读 share_cmd.json {op:upload|list|get, seq, path/id}，结果写回 share_result.json {seq, ok, msg}；
       list → share_list.json；get → share_download.json。seq 回显给 mod 对号，防读到旧结果。"""
    moddir = os.path.dirname(os.path.abspath(cmdfile))

    def put(name, obj):
        p = os.path.join(moddir, name)
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False)
        os.replace(tmp, p)                   # 原子替换：mod 轮询绝不读到写一半的结果

    cmd = _read_json(cmdfile, {})
    try:
        seq = int(cmd.get("seq") or 0)
    except Exception:
        seq = 0
    op = str(cmd.get("op") or "")

    def done(ok, msg="", extra=None):
        try:
            r = {"seq": seq, "ok": 1 if ok else 0, "msg": msg}
            if extra:
                r.update(extra)               # ★upload 靠它把【六位分享码】带回 mod，见下面 op=="upload"
            put("share_result.json", r)
        except Exception as e:
            log("写结果失败: %r" % e)
        log("sharecmd %s: %s %s" % (op, "OK" if ok else "FAIL", msg))

    def friendly(e):
        if isinstance(e, urllib.error.HTTPError):
            if e.code == 403:
                return "服务器拒绝：令牌不对(cloud.json 的 token 要和服务器一致；下载别人的配置不需要令牌)"
            if e.code == 404:
                return "这个分享码不存在(核对一下六位数；配置被作者删了也会这样)"
            if e.code == 413:
                return "配置太大，服务器拒收"
            if e.code == 429:
                # ★服务端对 GET /api/share/<码> 限速(单 IP 10 分钟 30 次)，防的是「从 100000 数到 999999」把码枚举出来。
                #   正常人手输一个码点一下，30 次绰绰有余 —— 撞到这个只可能是打错了很多次。
                return "试得太频繁，歇 10 分钟再来(防的是有人拿机器猜码)"
            return "服务器返回 HTTP %d" % e.code
        return "连不上服务器(%s)——检查网络和 cloud.json 的 server 地址" % e.__class__.__name__

    server, token = _cloud_cfg(moddir)
    if not server:
        done(False, "未配置服务器：cloud.json 里填上 server 地址")
        return
    try:
        if op == "upload":
            path = cmd.get("path") or os.path.join(moddir, "share_upload.json")
            profile = _read_json(path, None)
            if not isinstance(profile, dict) or not isinstance(profile.get("data"), dict):
                done(False, "本地档案没生成好(share_upload.json 异常)")
                return
            if not token:
                done(False, "上传需要令牌：cloud.json 里填 token(下载浏览不用)")
                return
            r = _http_json("POST", server + "/api/share", {"s": token, "profile": profile})
            if not r.get("ok"):
                done(False, str(r.get("err") or "服务器拒绝"))
                return
            # ★★这里【以前把码扔了】：老代码是 done(bool(r.get("ok")), ...)，只回传 ok/msg，
            #   而服务器应答里的 r["id"] 就是那个六位分享码 —— 服务器摇了码，主播永远看不见。
            #   六位码这个功能因此整条是死的(服务端早就写好了，断在这一行)。
            code = str(r.get("id") or "")
            if not code:
                done(False, "服务器没给分享码(它可能还是老版本)")
                return
            done(True, code, {"id": code})
        # ★没有 op=="list"：**这是设计，不是漏掉的**。用户 2026-07-15 原话「只有给分享码六位数数字，
        #   才能拿到他的分享，不然玩这个游戏的人都能下载的话就不好了」——「列个单子随便挑」正是他要关掉的那扇门。
        #   服务端 GET /api/shares 现在要管理令牌(只给我的后台 GUI)，主播这条路上不该有列表可言。
        #   老代码这里有个不带令牌的 list → 现在必吃 403。删掉，别留个一点就报错的按钮。
        elif op == "get":
            sid = str(cmd.get("id") or "")
            r = _http_json("GET", server + "/api/share/" + urllib.parse.quote(sid))
            if not isinstance(r.get("profile"), dict):
                done(False, "下载内容异常(缺 profile)")
                return
            put("share_download.json", r)
            done(True)
        else:
            done(False, "未知操作 %r" % op)
    except Exception as e:
        done(False, friendly(e))


class LiveStats:
    """本场直播互动统计：只计数值，绝不落观众昵称(隐私红线，同注释老约定)。
    每 10s 写 Mods/WheelLive/live_stats.json，客户端「直播统计」页读它展示本场报告。
    结构: {room, started, last, gifts, coins, likes, follows, running}"""
    def __init__(self, bridge, room):
        self._dir = os.path.dirname(os.path.abspath(bridge.path))
        self._file = os.path.join(self._dir, "live_stats.json")
        self._started = int(time.time())
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._data = {"room": str(room or "")[:64], "started": self._started,
                      "last": self._started, "gifts": 0, "coins": 0,
                      "likes": 0, "follows": 0, "running": 1}
        threading.Thread(target=self._loop, daemon=True).start()
        self.save()

    def _loop(self):
        while not self._stop.is_set():
            self._stop.wait(10.0)
            self.save()

    def tick_gift(self, cnt, coins):
        n = max(1, int(cnt or 1))
        with self._lock:
            self._data["gifts"] += n
            self._data["coins"] += int(coins or 0) * n
            self._data["last"] = int(time.time())

    def tick_like(self, delta):
        with self._lock:
            self._data["likes"] += max(0, int(delta or 0))
            self._data["last"] = int(time.time())

    def tick_follow(self):
        with self._lock:
            self._data["follows"] += 1
            self._data["last"] = int(time.time())

    def stop(self):
        self._stop.set()
        with self._lock:
            self._data["running"] = 0
            self._data["last"] = int(time.time())
        self.save()

    def save(self):
        with self._lock:
            data = dict(self._data)
        try:
            tmp = self._file + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, self._file)
        except Exception:
            pass   # 统计写失败绝不影响直播


def start_heartbeat(bridge, stop):
    """每 5s 发一次 ping，让 mod 那边的「已连接●」不掉。只在真正连上后才启动。"""
    def hb():
        while not stop.is_set():
            bridge.ping()
            stop.wait(5.0)
    t = threading.Thread(target=hb, daemon=True)
    t.start()
    return t


def run_sim(bridge, stop):
    log("演示/模拟模式：定时造假礼物+假点赞喂给游戏（Ctrl+C 结束）")
    start_heartbeat(bridge, stop)
    stats = LiveStats(bridge, "sim")
    next_gift = time.time() + 1.5
    next_like = time.time() + 1.0
    next_social = time.time() + 4.0   # 关注/灯牌 也偶尔造，验证「关注/灯牌→盲盒」整条链路
    while not stop.is_set():
        now = time.time()
        if now >= next_like:
            next_like = now + random.uniform(1.2, 2.6)
            d = random.randint(8, 28)
            bridge.like(d)
            stats.tick_like(d)
        if now >= next_gift:
            next_gift = now + random.uniform(3.0, 6.0)
            g = random.choice(PRESET_GIFTS)
            n = random.choice([1, 1, 1, 2, 5])
            fan = random.choice(SIM_FANS)
            bridge.gift(g, n, fan)
            log("模拟礼物: %s x%d  by %s" % (g, n, fan))
            # 模拟礼物随机给点抖币，好让「本场报告」在联调里也看得见数
            stats.tick_gift(n, random.choice([0, 0, 1, 2, 10]))
        if now >= next_social:
            next_social = now + random.uniform(5.0, 10.0)
            fan = random.choice(SIM_FANS)
            if random.random() < 0.5:
                bridge.follow(fan); log("模拟关注 by %s" % fan)
                stats.tick_follow()
            else:
                bridge.badge(fan); log("模拟灯牌 by %s" % fan)
        stop.wait(0.2)
    stats.stop()


def run_room(bridge, room_id, stop, cloud=None, platform="douyin"):
    """
    连真直播间(经同目录的平台房间模块)。platform: douyin(默认) / bilibili。
    ★铁律：任何一步失败都 status 上报+退出，绝不降级成模拟礼物——
      主播看到的每个礼物都必须是真的。想试效果请用游戏里的【自测】按钮或命令行 --sim。
    ★多平台只换「房间模块」与礼物图子目录；回调/统计/头像/重连全平台无关，原样复用。
    """
    platform = (platform or "douyin").strip().lower()
    plat_name = {"douyin": "抖音", "bilibili": "B站"}.get(platform, platform)
    log("尝试连接%s直播间: %s" % (plat_name, room_id))
    try:
        import requests   # noqa
        import websocket  # noqa  (websocket-client)
    except Exception as e:
        bridge.status("连不上真直播间：本机 Python 缺依赖(%s)。先运行: pip install requests websocket-client" %
                      e.__class__.__name__)
        return

    # 按平台选房间模块（鸭子接口一致：构造(room_id)+可赋值 on_*+run(stop)+census_text()+_ended/_throttled）
    try:
        if platform == "bilibili":
            from bilibili_room import BilibiliLiveRoom as RoomClass
        else:
            from douyin_room import DouyinLiveRoom as RoomClass
    except Exception as e:
        bridge.status("连不上真直播间：缺少 %s 弹幕组件(%r)。请重装安装包补齐。" % (plat_name, e))
        return
    # 礼物图子目录按平台分（抖音沿用「抖音」目录名，兼容既有图与客户端读取路径）
    gift_dir_name = "抖音" if platform == "douyin" else platform

    hb_started = [False]

    # 本场直播互动统计：礼物/点赞/关注计数，写 live_stats.json 供客户端统计页读。
    # ★延迟到第一次 on_beat（真正连上直播间）才创建，避免「没开播/没连上」就开始计时。
    stats = [None]
    # 头像缓存：avatars/ 就在 bridge.txt 同目录下(= Mods\WheelLive\avatars)。
    avatars = AvatarCache(bridge, os.path.join(os.path.dirname(os.path.abspath(bridge.path)), "avatars"), stop)
    # 礼物图缓存：礼物图/抖音/ 就在 bridge.txt 同目录下(= Mods\WheelLive\礼物图\抖音)。
    #   收到真礼物时把抖音下发的礼物图标 URL 下载成本地图，客户端透明图/贴纸/动画/时间插件直接读。
    gift_images = GiftImageCache(
        os.path.join(os.path.dirname(os.path.abspath(bridge.path)), "礼物图", gift_dir_name), stop)
    # ★把头像缓存挂给云端：世界榜上报时用它补观众头像 URL(在这之前世界榜头像 0% 可用，两边都以为对方补)。
    #   ★注意只传 URL 上云，avatars/ 里的本地图片文件绝不外传(观众头像文件是隐私红线，连打包都不许进)。
    if cloud:
        try: cloud.attach_avatars(avatars)
        except Exception: pass

    def on_status(text):
        bridge.status(text)

    # ★事件普查节拍(2026-07-16)：为查用户报的「关注盲盒和灯牌盲盒现在是触发不了的」。
    #   这 bug 我本机复现不了(关注/灯牌只有真直播间会推)，mod 侧已实测是好的 → 只能靠用户真开播时把现场证据带回来。
    #   每 3 分钟打一次；★同时 queue_error 一次，让它随错误回传上服务器 —— 用户不必手动翻日志给我。
    #   普查内容只有方法名/计数/action 值/异常类型名，不含直播间号、不含观众昵称(红线)。
    census_next = [time.time() + 180.0]
    room_ref = [None]

    def on_beat():
        # 第一次真的连上(收到服务器数据)才开始保活心跳→游戏里才亮「已连接●」
        if not hb_started[0]:
            hb_started[0] = True
            start_heartbeat(bridge, stop)
        bridge.ping()
        now = time.time()
        if now >= census_next[0] and room_ref[0] is not None:
            census_next[0] = now + 180.0
            try:
                t = room_ref[0].census_text()
                log(t)
                queue_error("census", t)
            except Exception:
                pass

    def on_living():
        # 收到第一条真实直播数据(非心跳) → 确认直播间在直播 → 才开始本场计时。
        #   on_beat 是 ws 打开/心跳，没开播也能触发，不能拿它当开播信号。
        if stats[0] is None:
            stats[0] = LiveStats(bridge, room_id)

    # 自动重连：ws 断了(网络抖动/签名过期/被限流)就退避重连，直播真结束或用户停了才收手。
    #   每次都新建 DouyinLiveRoom 重跑完整握手(重新拿 ttwid/room_id/签名)，避免拿旧签名反复连不上。
    attempts = 0
    backoff = 5
    while not stop.is_set():
        ended = False
        try:
            room = RoomClass(room_id)
            def on_gift(name, cnt, sender=None, avatar=None, coins=None, gift_img=None):
                # 桥写入/待发落盘是礼物交付的提交点。统计、头像和日志都属于旁路，
                # 不能在桥失败时先推进，否则抖音重投也会被连击去重挡掉。
                if not bridge.gift(name, cnt, sender, coins):
                    return False
                try:
                    if stats[0]: stats[0].tick_gift(cnt, coins)
                except Exception as e:
                    log("礼物统计失败(不影响已交付): %s" % type(e).__name__)
                try:
                    avatars.announce(sender)                 # 已有头像 → 立即重挂(抗 mod 重启丢登记)
                    avatars.offer(sender, avatar)            # 没有/URL 变了 → 后台下载
                    gift_images.offer(name, gift_img)        # ★礼物图自动下载到 礼物图/抖音/
                except Exception as e:
                    log("礼物附属资料失败(不影响已交付): %s" % type(e).__name__)
                log("礼物: %s x%d%s%s" % (name, cnt, ("  by " + sender) if sender else "",
                                          # ★用户 2026-07-16：「除了我的后台以外，不要显示出抖币两个字」。
                                          #   这行日志主播是会打开看的 → 算「显示」。改说「分/个」——
                                          #   而且这本来就更准：coins 进了榜单就是分，说「分」才是它在这套系统里的身份。
                                          ("  %d分/个" % coins) if coins is not None else "  (分值未知)"))
                return True
            room.on_gift = on_gift
            room.on_anchor = lambda name, avatar=None: (
                bridge.send("anchor " + (name or "").replace("\n", " ").replace("\r", " ").strip()),
                avatars.announce(name),                   # 已有头像 → 立即重挂
                avatars.offer(name, avatar),              # 没有/URL 变了 → 后台下载(下好自动发 avatar 行)
                (cloud.set_anchor(name, avatar) if cloud else None),   # 喂给云端：卡密心跳带上主播名/头像
                log("认出主播: %s" % _oneline(name)))
            # 点赞也打到 stdout：客户端的点赞规则/本场统计/弹幕转发全靠这一行（以前只写 bridge，客户端永远收不到点赞）
            room.on_like = lambda delta, sender=None: (
                (stats[0].tick_like(delta) if stats[0] else None), bridge.like(delta, sender),
                log("点赞: %d%s" % (int(delta or 0), ("  by " + _oneline(sender)) if sender else "")))
            room.on_follow = lambda sender=None: (
                (stats[0].tick_follow() if stats[0] else None),
                bridge.follow(sender), log("关注%s" % (("  by " + _oneline(sender)) if sender else "")))
            room.on_badge = lambda sender=None: (
                bridge.badge(sender), log("灯牌%s" % (("  by " + _oneline(sender)) if sender else "")))
            # 进场 / 弹幕(2026-09-13)：douyin_room 从 user 子消息把头像 URL 一起给过来——
            #   客户端「大哥进场」的观众名单/横幅以前只有送过礼的人才有头像(连接器只在礼物时下头像)。
            #   ① 本地已有 → announce 先发「头像:」行再打「进场:」行，客户端处理进场事件时头像已在内存表里；
            #   ② 没有 → 低优先级车道后台下载(礼物头像永远优先、排满就丢)，下好再发「头像:」行回填。
            #   只在本机 avatars/ 落盘，不上云、不索要粉丝列表；抽不到头像的观众客户端显示默认图。
            def on_member(nick, avatar=None):
                try:
                    avatars.announce(nick)
                    avatars.offer(nick, avatar, low=True)
                except Exception as e:
                    log("进场头像失败(不影响进场事件): %s" % type(e).__name__)
                log("进场: %s" % _oneline(nick or "?"))

            def on_chat(nick, content, avatar=None):
                log("弹幕: %s %s" % (_oneline(nick or "?"), _oneline(content or "")))
                try:
                    avatars.offer(nick, avatar, low=True)   # 只发弹幕不进场的观众也进名单；已缓存的客户端自己按昵称哈希找
                except Exception as e:
                    log("弹幕头像失败(不影响弹幕事件): %s" % type(e).__name__)

            room.on_chat = on_chat
            room.on_member = on_member
            room.on_status = on_status
            room.on_beat = on_beat
            room.on_living = on_living
            room_ref[0] = room                   # ★给普查节拍拿现场用(每次重连都是新 room，这里要跟着换)
            room.run(stop)                       # 阻塞到 ws 断开或 stop
            ended = getattr(room, "_ended", False)
            # 断开时补一次普查：短连接(没撑到 3 分钟节拍)也要留下证据
            try:
                t = room.census_text(); log(t); queue_error("census", t)
            except Exception:
                pass
        except Exception as e:
            bridge.status("真直播间连接出错：%r（未连接，不会模拟礼物）" % e)
            queue_error("room", repr(e))

        if stop.is_set() or ended:
            if stats[0]:                         # 下播/用户停 → 统计置 running:0 落盘
                stats[0].stop()
            break                                # 用户停了 / 直播真结束 → 不再重连

        attempts += 1
        if attempts > 20:
            bridge.status("重连多次仍不稳定，暂停自动重连（可稍后再点连接）")
            break
        wait = min(90, backoff * 3) if getattr(room, "_throttled", False) else backoff
        bridge.status("连接断开，%d 秒后自动重连（第 %d 次）…" % (wait, attempts))
        stop.wait(wait)
        backoff = min(60, backoff + 5)


def run_applyonly(bridge_path, room, ver, timeout=600):
    """一次性「申请购买」发送模式(mod 在常驻连接器没跑时拉起)：只开云端线程——
       把 apply_request.json 发到服务器 + 长轮询即时解锁(作者一批准，几秒内解锁)。
       不连直播间、不扫码登录、不往事件桥写任何礼物事件(bridge 只用来定位 mod 目录/更新行)。
       退出：申请已发出且已授权 → 提前收工；否则挂满 timeout 秒(作者在线秒批的窗口)自动退。"""
    moddir = os.path.dirname(os.path.abspath(bridge_path))
    bridge = Bridge(bridge_path)              # 只给 cloud 的版本推送写 update 行用
    stop = threading.Event()
    cloud = Cloud(moddir, room, ver)
    if not cloud.enabled:
        log("云端未配置(cloud.json 缺 server)，申请发不出去。")
        return
    cloud.start(bridge, stop)                 # 首拍就会跑 check_apply → 几秒内申请就发出去了
    log("申请发送模式：最多挂 %d 秒(作者批准即秒解锁)，期间不连直播间。" % timeout)
    t0 = time.time()
    apf = os.path.join(moddir, "apply_request.json")
    licf = os.path.join(moddir, "license_status.json")
    try:
        while time.time() - t0 < timeout:
            time.sleep(3)
            sent = not os.path.isfile(apf)    # 申请文件被消费 = 已发出(或服务器回「本来就已授权」)
            lic = _read_json(licf, None)
            licensed = isinstance(lic, dict) and str(lic.get("licensed") or "0") in ("1", "True", "true")
            if sent and licensed:
                log("已授权，申请发送模式收工。")
                break
    except KeyboardInterrupt:
        pass
    stop.set()
    log("申请发送模式退出(申请%s)。" % ("已发出" if not os.path.isfile(apf) else "未能发出——下次进游戏会自动重试"))


def _start_parent_watchdog():
    """客户端把自己的 PID 放在环境变量 ZL_PARENT_PID：客户端被杀 / 更新安装 / 以管理员重启时（这些路径不会走它的
       window-all-closed），这里 5 秒内跟着退出。以前留下的孤儿连接器握着单实例互斥量，之后再启动的全被它顶掉，
       还锁着客户端自带的 pyembed 让更新安装失败。"""
    pid = os.environ.get("ZL_PARENT_PID", "")
    if os.name != "nt" or not pid.isdigit():
        return

    def loop():
        try:
            import ctypes
            k32 = ctypes.windll.kernel32
            SYNCHRONIZE = 0x00100000
            h = k32.OpenProcess(SYNCHRONIZE, False, int(pid))
            if not h:
                return
            try:
                while True:
                    if k32.WaitForSingleObject(h, 5000) == 0:   # WAIT_OBJECT_0 = 父进程已退出
                        log("客户端已退出，连接器跟着退出")
                        os._exit(0)
            finally:
                k32.CloseHandle(h)
        except Exception:
            pass
    threading.Thread(target=loop, daemon=True).start()


def main():
    _start_parent_watchdog()
    if os.name == "nt":   # 控制台(如果有)能正常显示中文日志
        try:
            os.system("chcp 65001 >nul")
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--room", default="", help="直播间号/短号(抖音=live.douyin.com/后面那串；B站=live.bilibili.com/后面那串)")
    ap.add_argument("--platform", default="douyin", help="直播平台: douyin(默认) / bilibili")
    ap.add_argument("--game", default="4wheel-challenge", help="游戏ID(catalog id, 运营数据按游戏分账)")
    ap.add_argument("--sim", action="store_true", help="纯模拟(不连真直播间)")
    ap.add_argument("--bridge", default="", help="事件桥文件 bridge.txt 的完整路径(--sharecmd 模式不用)")
    ap.add_argument("--sharecmd", default="", help="一次性云端分享命令文件 share_cmd.json 的路径(干完就退)")
    ap.add_argument("--applyonly", action="store_true",
                    help="一次性「申请购买」发送模式：只跑云端线程(发 apply_request.json + 长轮询即时解锁)，不连直播间，约10分钟自动退")
    ap.add_argument("--checkupdate", action="store_true", help="一次性查版本清单(不用连直播间)：有新版就往事件桥写 update 行，干完就退")
    ap.add_argument("--installupdate", default="", help="一次性内置更新：等游戏退干净→静默装这个安装包→把游戏拉回来，干完就退")
    ap.add_argument("--gamedir", default="", help="--installupdate 用：装回哪个游戏目录")
    ap.add_argument("--relaunched", action="store_true",
                    help="--installupdate 内部用：标记「我已经是从 %%TEMP%% 重新拉起的那一个了」，别再拷一次(见 run_installupdate)")
    ap.add_argument("--version", dest="local_version", default="0.0.0",
                    help="mod 当前版本号(云端·版本推送用它和服务器清单比对)")
    args = ap.parse_args()

    # 一次性「内置更新」模式：等游戏退→静默装→拉回游戏，干完就退。不抢单实例锁(游戏正在关，桥那边不用管)。
    if args.installupdate:
        # ★★退出码是【契约】，mod 侧 Connector.InstallUpdateNow 的秒退闸门就靠它判「这脚本到底接没接手」：
        #     0 = 接手了(交棒给临时目录那个进程 / 或原地装完了) → mod 可以放心关游戏
        #     2 = argparse 不认参数(旧 connector.py 配新 DLL) → 【绝不能关游戏】
        #     3 = 安装包不见了 → 同上
        #   ★闸门认【退出码】不认【耗时】：交棒那条路很可能 1.5s 内就退，按"秒退=失败"判会把成功误判成失败，
        #     然后游戏不关、而分离出去的安装器等满 60s 再被 Inno 硬 taskkill —— 两个修法凑一起造出来的新坑。
        sys.exit(run_installupdate(args.installupdate, args.gamedir, args.bridge, args.relaunched) or 0)

    # 一次性「立即检查新版本」模式：查完清单就退出，不连直播间、不抢单实例锁(所以开着播也能点)。
    if args.checkupdate:
        run_checkupdate(args.bridge, args.local_version)
        return

    # 一次性「云端分享」模式：执行 share_cmd.json 里的一条命令就退出，不碰事件桥、不抢单实例锁。
    if args.sharecmd:
        run_sharecmd(args.sharecmd, args.local_version)
        return
    if not args.bridge:
        ap.error("--bridge 是必填(除非用 --sharecmd)")

    # 一次性「申请购买」发送模式(★修用户 7-21「申请卡密我这边收不到,都是手动填直播间号」的死锁：
    #   老链路申请靠常驻连接器代发,而常驻连接器要扫码登录抖音才启动——新用户没登录,点了申请
    #   文件永远躺在本地,界面还显示"已提交"。这个模式绕开登录/直播间,只把申请发出去+等秒解锁)。
    #   和常驻连接器共用同一把单实例锁：抢不到=正主在跑,它每45秒扫申请文件,交给它即可。
    if args.applyonly:
        if not acquire_single_instance(args.bridge):
            log("已有连接器在跑同一事件桥——申请交给它代发(它每45秒扫一次申请文件)，本进程退出。")
            return
        _ERRQ["dir"] = os.path.dirname(os.path.abspath(args.bridge))
        _ERRQ["ver"] = args.local_version
        run_applyonly(args.bridge, args.room, args.local_version)
        return

    bridge = Bridge(args.bridge)
    stop = threading.Event()

    # 单实例：已有连接器在跑同一直播桥 → 退出，免得每个礼物被重复上报(×2/×3)。
    if not acquire_single_instance(args.bridge):
        bridge.status("已有连接器在运行，本次不再启动(避免礼物重复上报)。要重连请先在游戏里断开。")
        log("检测到已有连接器在跑同一事件桥，退出以免礼物翻倍。")
        return

    log("已连上事件桥: %s" % args.bridge)

    # 错误报告队列落在 mod 目录(和 bridge 同目录)，连接器自己的异常也记进去
    _ERRQ["dir"] = os.path.dirname(os.path.abspath(args.bridge))
    _ERRQ["ver"] = args.local_version

    # 云端·总分榜上报 + 版本推送 + 卡密心跳 + 错误回传(后台线程；服务器没配/断网都不影响游戏，异常全吞)。
    cloud = Cloud(os.path.dirname(os.path.abspath(args.bridge)), args.room, args.local_version, game=getattr(args, "game", "4wheel-challenge"))
    cloud.start(bridge, stop)

    try:
        if args.sim or not args.room:
            run_sim(bridge, stop)
        else:
            run_room(bridge, args.room, stop, cloud, platform=getattr(args, "platform", "douyin"))
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        log("已退出。")


if __name__ == "__main__":
    main()
