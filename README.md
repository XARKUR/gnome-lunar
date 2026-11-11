# gnome-lunar

GNOME Shell 农历扩展：在顶栏时钟和原生月历中显示农历、传统节日、二十四节气与干支生肖。支持 GNOME **43、48、51**；43 使用独立的旧式加载包，48/51 使用 ESM 包。

## 安装或更新

在 GNOME 桌面中，以普通用户运行：

```sh
curl -fsSL https://raw.githubusercontent.com/XARKUR/gnome-lunar/main/install.sh | sh
```

也可以先下载脚本查看，再执行：

```sh
curl -fsSLo install.sh https://raw.githubusercontent.com/XARKUR/gnome-lunar/main/install.sh
sh install.sh
```

已下载源码时，进入项目目录执行 `./install.sh`。首次安装和更新使用同一命令：自动选择 Shell 加载方式、备份旧版、保留显示偏好，并保存扩展启用设置。与原版 Lunar Calendar 同时启用会冲突，脚本会关闭原版并启用本扩展。安装完成后**注销并重新登录**。

脚本只写当前用户的应用数据目录，不会安装系统软件。需要 Python 3.9+、GNOME Shell、`gsettings` 和 `glib-compile-schemas`。完整 GNOME 桌面通常已有这些组件；缺少时可安装：

```sh
# Debian
sudo apt install python3 libglib2.0-bin

# Arch Linux
sudo pacman -S --needed python glib2
```

下载脚本需要 curl 和网络；从源码目录安装不需要网络、Git 或 Node.js。请勿以 root 或 sudo 运行安装脚本。

## 显示与设置

- 顶栏保留原有公历时钟格式，追加农历日期；可选显示时辰。
- 月历日期格显示农历，可选择节日、节气标注及三档字号。
- 月历标题直接显示日期，例如“十月十四 · 小雪”，右侧显示干支生肖。
- 标题保留点击返回今天的行为；停用扩展会恢复原生布局。
- 点击扩展的设置入口调整显示。安装与更新不会强制应用显示预设。

农历范围为公历 **1734–2200 年**。历法采用现代中国历法和 UTC+08:00 天文日界，界面使用当前时区的公历日期；干支年与生肖以农历新年为年界。范围外不标注农历。节日不包含逐年法定放假或调休安排。

保留内部 UUID `lunar-calendar@system.local` 和原设置 schema，以兼容已有设置。卸载前关闭扩展，然后执行：

```sh
gnome-extensions uninstall lunar-calendar@system.local
```

更新备份保存在 `${XDG_DATA_HOME:-~/.local/share}/gnome-extension-project-backups/`。可选预设为 `profiles/example.json`；复制为 `profiles/current.json` 后可单独修改，该文件不纳入版本控制。使用 `python3 project.py preset --apply` 才会应用预设。

## 开发与验证

```sh
git clone https://github.com/XARKUR/gnome-lunar.git
cd gnome-lunar
python3 project.py check
python3 project.py package             # GNOME 48/51
python3 project.py package --shell 43  # GNOME 43
```

开发检查还需要 GJS 和 Node.js；运行扩展不需要 Python 或 Node.js。测试使用临时目录和内存设置后端，涵盖历法日期、闰月、除夕、节气、跨月排版接口、设置同步、启停清理和安装更新。原生 Shell 接口测试使用模拟显示对象，不能代替实际主题、显示缩放与桌面视觉验收。验证范围见 `VALIDATION.json`。

源码入口：`src/extension.js`；日期菜单接入：`src/ui/dateMenu.js`；历法接口：`src/calendar/`；设置窗口：`src/prefs.js`。安装器自动选择适配包；不要只修改元数据中的 Shell 版本号来绕过兼容性检查。

## 许可证与来源

扩展界面、格式化、日期接口和安装工具为独立实现，以 GPL-3.0-or-later 发布。天文算法和数据来自 **ChineseCalendar**，保留原作者署名、来源与许可证，不声称为本项目原创。GNOME 原生接口测试摘录保留相应许可。详见 `LICENSE`、`NOTICE` 和 `upstream.lock.json`。

参考：[Lunar Calendar](https://extensions.gnome.org/extension/675/lunar-calendar/)、[ChineseCalendar](https://github.com/ytliu0/ChineseCalendar)。本项目不是上述扩展的官方发布版本。
