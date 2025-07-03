### ![My Logo](https://extensions.gnome.org/extension-data/icons/icon_8183_D52D21u.png) System Info HUD

A GNOME extension that displays detailed system information in a convenient HUD. It supports most major Linux distributions and works on Intel, AMD, and ARM CPUs.

## Features
- **CPU Info:** Model, core count, per-core speed, and temperature (Intel, AMD, ARM)
- **Memory Info:** Total, used, cache, and usage percentage
- **Storage Info:** Disk usage for all real devices
- **Network Info:** LAN IP, public IP, WiFi SSID, and network speed
- **GPU Info:** NVIDIA, AMD, Intel (limited ARM SoC support)
- **Power Info:** Battery status (if available)
- **Uptime:** System uptime

## Dependencies
The following command-line tools must be available on your system:

- `lscpu` (for CPU info)
- `cat` (for reading /proc files)
- `free` (for memory info)
- `df` (for storage info)
- `ip` (for LAN IP)
- `iwgetid` (for WiFi SSID, or optionally `nmcli`)
- `sensors` (from `lm_sensors`, for CPU temperature)
- `lspci` (for GPU info)
- `nvidia-smi` (for NVIDIA GPU info, if applicable)
- `rocm-smi` (for AMD GPU info, if applicable)
- `upower` (for battery info)
- `Soup` library (for public IP)

**Note:** Most of these are installed by default on GNOME-based distributions, but some (like `iwgetid`, `sensors`, `lspci`, `nvidia-smi`, `rocm-smi`) may need to be installed manually.

### Installing Missing Dependencies

**Ubuntu/Debian:**
```
sudo apt update
sudo apt install lm-sensors pciutils wireless-tools upower
```

**Fedora:**
```
sudo dnf install lm_sensors pciutils wireless-tools upower
```

**Arch Linux:**
```
sudo pacman -S lm_sensors pciutils wireless_tools upower
```

**openSUSE:**
```
sudo zypper install sensors pciutils wireless-tools upower
```

## Installation
1. Clone or download this repository.
2. Copy the extension folder to your GNOME extensions directory (usually `~/.local/share/gnome-shell/extensions/`).
3. Enable the extension using GNOME Tweaks or Extensions app.
4. Restart GNOME Shell if needed.

or download in gnome shell search System HUD

## Contributing
Pull requests and issues are welcome!
