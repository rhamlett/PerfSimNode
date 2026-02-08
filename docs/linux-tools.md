# Linux Diagnostic Tools Guide

This guide covers command-line tools for diagnosing Node.js performance issues on Linux systems, including Azure App Service Linux.

## Process Monitoring

### top / htop

View real-time process information:

```bash
# Basic view
top

# Press '1' to show per-CPU usage
# Press 'M' to sort by memory
# Press 'P' to sort by CPU

# htop (more user-friendly)
htop
```

Key metrics:
- **%CPU** - CPU usage percentage
- **%MEM** - Memory usage percentage
- **VIRT** - Virtual memory
- **RES** - Resident memory (actual RAM used)
- **TIME+** - Total CPU time consumed

### ps

View process status:

```bash
# Show all processes with details
ps aux

# Filter for Node.js
ps aux | grep node

# Show process tree
ps auxf

# Show specific process details
ps -p <pid> -o pid,ppid,%cpu,%mem,vsz,rss,cmd
```

### /proc filesystem

Low-level process information:

```bash
# Process memory map
cat /proc/<pid>/maps

# Memory statistics
cat /proc/<pid>/status

# File descriptors
ls -la /proc/<pid>/fd

# System memory
cat /proc/meminfo

# CPU info
cat /proc/cpuinfo
```

## Memory Analysis

### free

View system memory:

```bash
# Human-readable format
free -h

# Show in MB
free -m

# Continuous monitoring
watch -n 1 free -m
```

### Memory Tools

```bash
# Show memory usage by process
smem -rs pss

# Memory usage summary
vmstat 1 5

# Cache and buffer details
cat /proc/meminfo | grep -E "Mem|Cache|Buffer"
```

## CPU Profiling

### Node.js Built-in Profiler

```bash
# Generate V8 profiler output
node --prof dist/index.js
# Creates isolate-*.log file

# Process the log
node --prof-process isolate-*.log > profile.txt

# Or generate JSON for Chrome DevTools
node --prof-process --preprocess isolate-*.log > profile.json
```

### CPU Usage Analysis

```bash
# Show CPU usage over time
mpstat 1

# Per-CPU statistics
mpstat -P ALL 1

# Process CPU accounting
pidstat 1

# Specific process
pidstat -p <pid> 1
```

## Network Analysis

### Connection Monitoring

```bash
# Show all network connections
netstat -an

# Show listening ports
netstat -tuln

# Show connections by state
netstat -an | grep ESTABLISHED | wc -l

# Using ss (modern alternative)
ss -tuln
ss -s  # Summary
```

### Testing Endpoints

```bash
# Basic request
curl http://localhost:3000/api/health

# With timing
curl -w "\nTime: %{time_total}s\n" http://localhost:3000/api/health

# Verbose with headers
curl -v http://localhost:3000/api/health

# POST with JSON
curl -X POST http://localhost:3000/api/simulations/cpu \
  -H "Content-Type: application/json" \
  -d '{"targetLoadPercent": 50, "durationSeconds": 10}'
```

## Log Analysis

### Viewing Logs

```bash
# Follow log file
tail -f /var/log/app.log

# Last N lines
tail -n 100 /var/log/app.log

# Search logs
grep "error" /var/log/app.log

# Search with context
grep -C 3 "exception" /var/log/app.log
```

### journalctl (systemd)

```bash
# Show service logs
journalctl -u myapp

# Follow new entries
journalctl -u myapp -f

# Since specific time
journalctl -u myapp --since "1 hour ago"

# Show errors only
journalctl -u myapp -p err
```

## Node.js Inspector

### Remote Debugging

```bash
# Start with inspector
node --inspect=0.0.0.0:9229 dist/index.js

# Start with inspector and break on first line
node --inspect-brk=0.0.0.0:9229 dist/index.js
```

Connect Chrome DevTools to `chrome://inspect`.

### Heap Snapshots

```bash
# Send signal to take heap snapshot
kill -USR2 <node_pid>

# Or use heapdump module
# require('heapdump').writeSnapshot('/tmp/heap.heapsnapshot');
```

## Azure App Service Specific

### Kudu SSH Console

Access via: `https://yourapp.scm.azurewebsites.net/webssh/host`

```bash
# Find Node.js process
ps aux | grep node

# View application files
ls -la /home/site/wwwroot

# Check logs
ls -la /home/LogFiles

# View deployment logs
cat /home/LogFiles/kudu/trace/*.txt
```

### Log Streaming

```bash
# Using Azure CLI
az webapp log tail --name <app-name> --resource-group <rg-name>

# Configure logs
az webapp log config --name <app-name> --resource-group <rg-name> \
  --application-logging filesystem --level verbose
```

## Quick Reference

| Task | Command |
|------|---------|
| CPU usage | `top` or `htop` |
| Memory usage | `free -m` |
| Process list | `ps aux \| grep node` |
| Network connections | `netstat -an` or `ss -tuln` |
| Disk usage | `df -h` |
| File handles | `lsof -p <pid>` |
| Follow logs | `tail -f <logfile>` |
| Test endpoint | `curl <url>` |
