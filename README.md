System Information HUD
This GNOME Shell extension provides a real-time heads-up display (HUD) of various system metrics. It collects and displays information such as memory usage, disk space, CPU load, network activity, Wi-Fi connection, and hardware temperature.

Memory Usage: free -h

Disk Space: df -h

CPU Usage: top -bn1

Wi-Fi SSID: iwgetid -r (requires iwgetid installed)

Network Stats: cat /proc/net/dev

Temperature Monitoring: sensors (requires lm-sensors)


Additionally, it uses the ipify.org service to detect and display your public IP address.

git https://github.com/LalaloyXyz/System-info
