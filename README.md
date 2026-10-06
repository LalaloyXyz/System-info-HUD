<div align="center">

<img src="https://extensions.gnome.org/extension-data/icons/icon_8183_D52D21u.png" width="128" alt="System Info HUD">

# System Info HUD

### A beautiful live system monitor for GNOME Shell that puts your hardware and system information at a glance.

<br>

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45%20|%2046%20|%2047%20|%2048%20|%2049%20|%2050%20|%2051-4A86CF)
![Platform](https://img.shields.io/badge/Platform-Linux-FCC624)
![License](https://img.shields.io/badge/License-GPL--3.0-green)

<br>

<a href="https://extensions.gnome.org/extension/8183/system-hud/">
  <img src="https://img.shields.io/badge/Download-GNOME%20Extensions-4A86CF?style=for-the-badge">
</a>

<a href="https://buymeacoffee.com/banditpetsw">
  <img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-orange?style=for-the-badge">
</a>

</div>

---

## ✨ Overview

**System Info HUD** is a lightweight GNOME Shell extension that displays live system statistics in a clean, colorful interface.

Click the **Info** indicator in the top panel to open the HUD. It shows hardware, operating-system, network, power, and performance information in one place, with theme-aware colors and live updates.

Designed to feel native to GNOME while remaining useful on a wide range of Linux systems.

## 📊 Features

### 🖥 Live System Monitoring

- CPU usage with per-core details and history graph
- Memory and swap usage
- Storage usage for mounted devices
- Network connection, IP, and transfer information
- GPU metrics when supported by the available tools
- Battery status, power use, and remaining time
- Operating system, kernel, GNOME session, and uptime details

### 🎨 Clean GNOME Integration

- Opens from the GNOME top-panel **Info** indicator
- Colorful progress bars for quick status checks
- Light and dark theme-aware colors
- Resizable HUD dimensions
- Optional open and close animations
- Drag the HUD to reposition it
- Close with the `Esc` key or the close button

### 📋 Handy Utilities

- Switch between **System Status** and **Processes**
- Search processes by name or PID and sort by CPU, GPU, or memory usage
- Use **Apps only** to show processes associated with running windowed applications
- End your own tasks with confirmation (sends SIGTERM; GNOME Shell is protected)
- CPU on the Processes page is the process lifetime average; RAM is resident memory in MiB
- Process GPU usage shows the busiest engine from readable DRM activity counters (including supported AMD/Intel drivers). The first sample and unsupported or inaccessible processes show **—**. This is interval usage; duplicate GPU descriptors are counted once.
- CPU and GPU graphs scroll measured samples horizontally without changing their heights or peaks; animation pauses when the page is hidden.
- Copy the system information to the clipboard
- Adjustable refresh interval from 500 ms to 10 seconds
- Optional CPU graph and power section
- Graceful fallbacks when optional hardware tools are unavailable

## 📡 Information Provided

| Section | What you get |
|---------|-------------|
| **CPU** | Processor model, core count, per-core speed, load, temperature, and history graph |
| **Memory** | RAM usage, swap usage, and cache |
| **Storage** | Mounted device usage, percentage used, and free space |
| **Network** | Wi-Fi SSID, LAN IP, public IP, and upload/download speed |
| **GPU** | VRAM usage, temperature, clocks, and utilization when available |
| **Power** | Battery percentage, charging status, power draw, and time remaining |
| **System** | Distribution, kernel, GNOME/session details, hostname, and uptime |

## 🔧 Requirements

### Platform

- Linux
- GNOME Shell 45, 46, 47, 48, 49, 50, or 51

### Core tools

The extension reads system information from common Linux tools:

```text
lscpu  free  df  ip  upower  cat  uname  gnome-shell  lspci  ps  kill
```

### Optional tools

| Tool | Provides |
|------|----------|
| `sensors` *(lm-sensors)* | CPU and GPU temperatures |
| `iwgetid` / `nmcli` / `iw` | Wi-Fi SSID details |
| `nvidia-smi` | NVIDIA GPU metrics |
| `rocm-smi` | AMD GPU metrics |
| `intel_gpu_top` | Intel GPU utilization and frequency |

> Optional tools are detected automatically. Missing tools produce a useful fallback instead of preventing the extension from loading.

## 🚀 Usage

1. Enable **System Info HUD**.
2. Click the **Info** indicator in the GNOME top panel.
3. Review live system information in the HUD.
4. Drag the HUD if you want to reposition it.
5. Press `Esc` or click `×` to close it.

Open the extension preferences to configure animations, refresh timing, HUD size, the CPU graph, the power section, and the copy button.

## 🤝 Contributing

Contributions, bug reports, and feature requests are welcome.

If a metric is missing or incorrect, please include your distribution, GNOME Shell version, hardware, and the relevant optional tools installed on your system.

Feel free to open an issue or submit a pull request on [GitHub](https://github.com/LalaloyXyz/System-info-HUD).

## 📄 License

System Info HUD is free software distributed under the [GNU General Public License v3.0](LICENSE).
</div>
