<div align="center">

<img src="https://extensions.gnome.org/extension-data/icons/icon_8183_D52D21u.png" width="80" alt="System Info HUD Icon"/>

# System Info HUD

**A modern GNOME Shell extension that shows live system stats in a clean UI**  
Designed to work across most Linux distributions.

<br/>

![GNOME](https://img.shields.io/badge/GNOME-Shell-4A86CF?style=flat-square&logo=gnome&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Linux-FCC624?style=flat-square&logo=linux&logoColor=black)
![License](https://img.shields.io/badge/License-GNU_General_Public_License_v3.0-34D399?style=flat-square)

</div>

---

## ✨ Highlights

- 📊 **7 live sections** — CPU, Memory, Storage, Network, GPU, Power, and Uptime
- 🎨 **Colorful progress bars** for instant status reading
- 🌗 **Dynamic theme-aware colors** — adapts to light and dark desktop mode

---

## 📸 Preview

> *Click the `Info` indicator in your GNOME top bar to open the HUD. Drag to reposition. Press `Esc` or `×` to close.*

---

## 📡 Data Shown

| Section | What you get |
|---------|-------------|
| **CPU** | Model, core count, per-core speed, per-core load, temperature |
| **Memory** | RAM usage, swap usage, cache |
| **Storage** | Per-device usage with percent and free space |
| **Network** | Wi-Fi SSID, LAN IP, public IP, upload/download speed |
| **GPU** | VRAM usage, temperature, clocks (when available) |
| **Power** | Battery percentage, status, power draw and time remaining |
| **System** | OS, kernel, GNOME/session details, uptime |

---

## Requirements

System Info HUD reads data from common Linux command-line tools.

### Core tools

```
lscpu  free  df  ip  upower  cat  uname  gnome-shell  lspci
```

### Optional tools

| Tool | Provides |
|------|----------|
| `sensors` *(lm-sensors)* | CPU & GPU temperatures |
| `iwgetid` / `nmcli` / `iw` | Wi-Fi SSID details |
| `nvidia-smi` | NVIDIA GPU metrics |
| `rocm-smi` | AMD GPU metrics |
| `intel_gpu_top` | Intel GPU utilization/frequency *(set `ENABLE_INTEL_GPU_TOP=1`)* |

> **Note:** Most GNOME-based distributions already include many of the core tools.

---

## 📦 Install Missing Dependencies

<details>
<summary><b>Ubuntu / Debian</b></summary>

```bash
sudo apt update
sudo apt install lm-sensors pciutils wireless-tools upower
```

</details>

<details>
<summary><b>Fedora</b></summary>

```bash
sudo dnf install lm_sensors pciutils wireless-tools upower
```

</details>

<details>
<summary><b>Arch Linux</b></summary>

```bash
sudo pacman -S lm_sensors pciutils wireless_tools upower
```

</details>

<details>
<summary><b>openSUSE</b></summary>

```bash
sudo zypper install sensors pciutils wireless-tools upower
```

</details>

---

## 📝 Notes

- Some metrics depend on hardware vendors and installed tools.
- If a required tool is missing, the HUD displays a helpful hint in the relevant section.

---

## 🤝 Contributing

Issues and pull requests are welcome!  

<div align="center">
<br/>
<sub>Built for the GNOME desktop</sub>
</div>