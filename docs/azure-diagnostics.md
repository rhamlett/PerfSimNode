# Azure Diagnostics Guide

This guide covers diagnostic tools and techniques for troubleshooting Node.js applications running on Azure App Service.

## App Service Diagnostics

### Accessing Diagnostics

1. Navigate to your App Service in Azure Portal
2. Select **Diagnose and solve problems** from the left menu
3. Browse available diagnostic tools

### Key Diagnostic Categories

#### Availability and Performance
- Overall health status
- Response time trends
- Availability SLA tracking

#### CPU Analysis
- **High CPU** - Identifies periods of elevated CPU usage
- **CPU Drill Down** - Detailed breakdown by process
- Use this when: CPU metrics show high utilization

#### Memory Analysis
- **Memory Analysis** - Heap usage and growth patterns
- **Memory Drill Down** - Per-process memory breakdown
- Use this when: Memory metrics show growth or high usage

#### Web App Slow
- Analyzes slow requests
- Identifies performance bottlenecks
- Correlates with dependencies

#### Web App Down or Restarted
- Crash analysis
- Container lifecycle events
- Error investigation

## Application Insights

### Setup

1. Create an Application Insights resource
2. Add the SDK to your application:

```bash
npm install applicationinsights
```

3. Initialize at application start:

```typescript
import * as appInsights from 'applicationinsights';

appInsights.setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
  .setAutoCollectRequests(true)
  .setAutoCollectPerformance(true)
  .setAutoCollectExceptions(true)
  .start();
```

### Key Features

#### Performance
- Request duration tracking
- Dependency call timing
- Custom metrics

#### Failures
- Exception tracking
- Failed request analysis
- Distributed tracing

#### Application Map
- Visual service dependencies
- Call flow visualization
- Latency breakdown

## Kudu Console (SCM)

Access at: `https://yourapp.scm.azurewebsites.net`

### Process Explorer
- View running processes
- CPU and memory per process
- Kill problematic processes

### Debug Console
- Bash or PowerShell access
- File system navigation
- Command execution

### Log Stream
- Real-time log streaming
- Application output
- Platform logs

### LogFiles
- Historical logs
- Download for offline analysis
- Error logs

## Common Scenarios

### High CPU

1. **Check App Service Diagnostics** → CPU Analysis
2. **Profile the application**:
   ```bash
   # In Kudu console
   node --prof /home/site/wwwroot/dist/index.js
   ```
3. **Review Application Insights** → Performance

### Memory Growth

1. **Check App Service Diagnostics** → Memory Analysis
2. **Take heap snapshot**:
   ```bash
   # Send signal to Node.js process
   kill -USR2 <pid>
   ```
3. **Review in Chrome DevTools** via remote debugging

### Application Crashes

1. **Check App Service Diagnostics** → Web App Restarted
2. **Review Kudu logs** → LogFiles/Application
3. **Check Application Insights** → Failures

### Slow Requests

1. **Check Application Insights** → Performance
2. **Enable detailed request tracing**
3. **Review dependency timings**

## Best Practices

1. **Always enable Application Insights** for production apps
2. **Set up alerts** for key metrics (CPU, memory, response time)
3. **Configure diagnostic logging** to Azure Blob Storage
4. **Use deployment slots** for testing and rollback
5. **Monitor WebSocket health** for real-time features
