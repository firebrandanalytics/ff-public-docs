# Job Scheduling & Work Queues: Background Tasks at Scale

This guide shows how to build scheduled and queued background tasks in FireFoundry using the Job Scheduling system. Learn to create cron-based jobs, manage work queues, and orchestrate complex asynchronous workflows.

## Table of Contents

1. [Overview](#overview)
2. [Core Components](#core-components)
3. [SchedulerNode: Cron-Based Scheduling](#schedulernode-cron-based-scheduling)
4. [CronJobManager: Distributed Execution](#cronjobmanager-distributed-execution)
5. [JobCallNode & WorkQueueNode](#jobcallnode--workqueuenode)
6. [Edge Types for Job Management](#edge-types-for-job-management)
7. [Complete Patterns](#complete-patterns)
8. [Real-World Examples](#real-world-examples)
9. [Troubleshooting](#troubleshooting)

---

## Overview

### What Are Scheduled Jobs?

Scheduled jobs allow your application to:

- **Run tasks on a schedule** - Daily reports, hourly cleanup, weekly summaries
- **Distribute work across instances** - Multiple replicas safely claim and execute jobs
- **Decouple work** - Queue work instead of blocking on execution
- **Resume and retry** - Leverage FireFoundry's resumable entity system
- **Scale horizontally** - Workers can be added/removed without coordination

### Architecture

The job scheduling system has three main components:

1. **SchedulerNode**: Defines when work should happen (cron schedules)
2. **JobCallNode**: Creates the actual work units to execute
3. **CronJobManager/WorkQueueNode**: Executes work safely and reliably

### High-Level Flow

```
SchedulerNode (holds job definitions)
    ↓ (cron tick fires)
JobCallNode (creates work instance)
    ↓ (marks as Pending)
RunnableEntity (actual work to do)
    ↓ (worker claims and executes)
CronJobManager/WorkQueueNode (worker loop)
    ↓ (atomically claims Pending → InProgress)
Work executes (with resumability/retries)
    ↓ (updates status)
Completed or Failed
```

---

## Core Components

### SchedulerNode

A `SchedulerNode` is an entity that holds job definitions and fires cron ticks.

#### Creating a SchedulerNode

```typescript
import { EntityFactory } from '@firebrandanalytics/ff-agent-sdk/entity';

async function createScheduler(factory: EntityFactory) {
  const schedulerNode = await factory.create_entity_node({
    agent_bundle_id: 'my-bundle',
    specific_type_name: 'SchedulerNode',
    general_type_name: 'Class',
    name: 'main-scheduler',
    data: {
      jobs: [
        {
          job_id: 'daily-summary',
          cron_string: '0 9 * * *',              // Every day at 9 AM
          target_entity_type: 'DailySummaryBot', // Entity class to instantiate
          input_data: {                          // Data passed to entity
            report_type: 'daily',
            recipients: ['team@example.com']
          },
          work_queue_node_id: 'work-queue-id',   // Where to queue work
          timezone: 'America/New_York',          // Optional timezone
          enabled: true
        },
        {
          job_id: 'hourly-cleanup',
          cron_string: '0 * * * *',              // Every hour
          target_entity_type: 'CleanupTask',
          input_data: { cleanup_scope: 'temp_files' },
          work_queue_node_id: 'work-queue-id',
          enabled: true
        }
      ]
    }
  });

  return schedulerNode;
}
```

#### Starting the Scheduler

```typescript
// Initialize the scheduler (loads job definitions from DTO)
await schedulerNode.initializeScheduler();

// Start all enabled cron jobs
schedulerNode.startScheduler();

// Later: Stop the scheduler
schedulerNode.stopScheduler();
```

#### Job Definition Type

```typescript
interface JobDefinition {
  job_id: string;                      // Unique identifier for this job
  cron_string: string;                 // Cron expression (e.g., '0 9 * * *')
  target_entity_type: string;          // Entity class name to instantiate
  input_data: JSONObject;              // Data passed to the entity's constructor
  work_queue_node_id: UUID;            // WorkQueueNode to queue work to
  timezone?: string;                   // Timezone for cron (e.g., 'America/New_York')
  enabled: boolean;                    // Enable/disable this job
}
```

### CronJobManager

The `CronJobManager` is a singleton that executes jobs claimed from the distributed queue.

#### Initialization

```typescript
import { CronJobManager } from '@firebrandanalytics/ff-agent-sdk/app';
import { RemoteEntityClient } from '@firebrandanalytics/ff-agent-sdk/client';

async function initializeJobManager(
  factory: EntityFactory,
  entityClient: RemoteEntityClient
) {
  const manager = CronJobManager.getInstance();

  // Initialize with factory and client
  // MUST be called before any job execution
  manager.initialize(factory, entityClient);

  // Start the worker loop
  manager.startWorkerLoop();

  return manager;
}
```

#### How It Works

The `CronJobManager` runs a worker loop that:

1. **Waits for a job signal** - Pulls from internal buffer
2. **Atomically claims work** - Tries to update status Pending → InProgress
3. **Fetches the RunnableEntity** - Gets the entity to execute
4. **Executes the job** - Calls entity.run() (fire-and-forget)
5. **Handles errors** - Logs failures, continues processing

```typescript
// Example: Signal a job (called by JobCallNode)
const runnableEntityId = 'run-123-abc';
manager.signalJob(runnableEntityId);

// The manager will:
// 1. Wait for this signal (FIFO)
// 2. Try to claim: update_node_status_conditional(Pending → InProgress)
// 3. If successful, fetch and run the entity
// 4. On error: mark as Failed, continue
```

#### Stopping the Manager

```typescript
// Gracefully stop accepting new jobs
await manager.stopWorkerLoop();

// Check status
const isRunning = manager.getIsRunning();
const isInitialized = manager.getIsInitialized();
```

### JobCallNode

The `JobCallNode` is a `RunnableEntity` that creates a work unit and signals the job manager.

#### What JobCallNode Does

1. Creates a `RunnableEntity` with job definition data
2. Creates edges:
   - **TriggersRun**: JobCallNode → RunnableEntity
   - **QueuedWork**: RunnableEntity → WorkQueueNode
3. Signals the `CronJobManager` to execute

#### Created By

- Automatically created by `SchedulerNode` when a cron tick fires
- Named deterministically: `job:{job_id}:{timestampUTC}` (ensures idempotency)

#### Implementation

```typescript
// This happens automatically when SchedulerNode.handleCronTick() fires
// For reference, here's the pattern:

protected async *run_impl() {
  // 1. Create RunnableEntity from job definition
  const runnableDTO: UnsavedEntityInstanceNodeDTO = {
    agent_bundle_id,
    name: `run:${jobDefinition.job_id}:${Date.now()}`,
    specific_type_name: jobDefinition.target_entity_type,
    status: 'Pending',
    data: jobDefinition.input_data
  };
  const createdRunnable = await this.factory.create_entity_node(runnableDTO);

  // 2. Create TriggersRun edge (JobCallNode → RunnableEntity)
  await createEdge('TriggersRun', this.id, createdRunnable.id);

  // 3. Create QueuedWork edge (RunnableEntity → WorkQueueNode)
  await createEdge('QueuedWork', createdRunnable.id, workQueueNodeId);

  // 4. Signal the job manager
  manager.signalJob(createdRunnable.id);

  return { runnableWorkEntityId: createdRunnable.id };
}
```

### WorkQueueNode

The `WorkQueueNode` provides local in-process job queueing for single-replica deployments.

#### When to Use

- **Single-replica deployments** - Don't need distributed coordination
- **Lower latency** - In-process signaling vs. database polling
- **Simpler setup** - Don't need CronJobManager initialization

#### Creating a WorkQueueNode

```typescript
async function createWorkQueue(factory: EntityFactory) {
  const workQueue = await factory.create_entity_node({
    agent_bundle_id: 'my-bundle',
    specific_type_name: 'WorkQueueNode',
    name: 'work-queue',
    data: {}  // No additional config needed
  });

  return workQueue;
}
```

#### Starting the Worker Loop

```typescript
async function startQueueWorker(workQueue: WorkQueueNode) {
  // Initialize the queue
  await workQueue.initializeQueue();

  // Start processing jobs
  await workQueue.startWorkerLoop();

  // The worker loop will:
  // 1. Wait for job signals (via PushPullBuffer)
  // 2. Fetch RunnableEntity
  // 3. Check status is Pending
  // 4. Execute entity.run() (fire-and-forget)
  // 5. Repeat
}
```

#### Queue Methods

```typescript
// Manually add a job to queue (rarely used - JobCallNode does this)
await workQueue.queueJob(runnableEntityId);

// Get next job from queue (internal - called by worker loop)
const nextJobId = await workQueue.waitNextJobId();

// Stop processing
await workQueue.stopWorkerLoop();
await workQueue.stopQueue();
```

---

## SchedulerNode: Cron-Based Scheduling

### Cron Expression Guide

Standard cron format: `minute hour day month weekday`

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

### Common Expressions

```typescript
'0 9 * * *'      // 9 AM every day
'0 */4 * * *'    // Every 4 hours
'*/15 * * * *'   // Every 15 minutes
'0 0 * * MON'    // Midnight every Monday
'0 0 1 * *'      // First day of each month
'0 0 1 1 *'      // January 1st every year
'*/5 * * * *'    // Every 5 minutes
```

### Adding Jobs Dynamically

```typescript
async function addJobDynamically(schedulerNode: SchedulerNode) {
  const dto = await schedulerNode.get_dto();

  // Add to jobs array
  const newJob: JobDefinition = {
    job_id: 'weekly-report',
    cron_string: '0 8 * * MON',
    target_entity_type: 'WeeklyReportGenerator',
    input_data: { include_metrics: true },
    work_queue_node_id: 'work-queue-id',
    enabled: true
  };

  dto.data.jobs.push(newJob);

  // Update the SchedulerNode data
  await schedulerNode.update_data(dto.data);

  // Reinitialize to load new job
  await schedulerNode.initializeScheduler();

  // Restart if already running
  schedulerNode.stopScheduler();
  schedulerNode.startScheduler();
}
```

### Timezone-Aware Scheduling

```typescript
const schedulerNode = await factory.create_entity_node({
  specific_type_name: 'SchedulerNode',
  data: {
    jobs: [
      {
        job_id: 'morning-report',
        cron_string: '0 9 * * *',
        timezone: 'America/New_York',    // 9 AM EST
        target_entity_type: 'DailyReport',
        input_data: {},
        work_queue_node_id: 'queue-id',
        enabled: true
      },
      {
        job_id: 'evening-report',
        cron_string: '0 18 * * *',
        timezone: 'Asia/Tokyo',          // 6 PM JST
        target_entity_type: 'DailyReport',
        input_data: {},
        work_queue_node_id: 'queue-id',
        enabled: true
      }
    ]
  }
});
```

### Disabling/Enabling Jobs

```typescript
async function toggleJob(schedulerNode: SchedulerNode, jobId: string, enabled: boolean) {
  const dto = await schedulerNode.get_dto();

  // Find and update job
  const job = dto.data.jobs.find((j: any) => j.job_id === jobId);
  if (job) {
    job.enabled = enabled;
    await schedulerNode.update_data(dto.data);

    // Reinitialize scheduler
    schedulerNode.stopScheduler();
    await schedulerNode.initializeScheduler();
    schedulerNode.startScheduler();
  }
}
```

---

## CronJobManager: Distributed Execution

### Why CronJobManager?

- **Distributed coordination** - Multiple replicas safely claim work
- **Atomic claims** - Database-level constraints prevent double-claiming
- **Fault tolerance** - Failed workers automatically retry work
- **Scaling** - Add/remove workers without coordination

### Setup Pattern

```typescript
async function setupDistributedJobExecution(
  factory: EntityFactory,
  entityClient: RemoteEntityClient
) {
  // 1. Initialize the singleton manager
  const manager = CronJobManager.getInstance();
  manager.initialize(factory, entityClient);

  // 2. Start the worker loop (runs in background)
  manager.startWorkerLoop();

  // 3. Create scheduler (signals jobs to manager)
  const scheduler = await factory.create_entity_node({
    specific_type_name: 'SchedulerNode',
    data: {
      jobs: [
        {
          job_id: 'hourly-task',
          cron_string: '0 * * * *',
          target_entity_type: 'HourlyTask',
          input_data: {},
          work_queue_node_id: 'any-id', // Ignored by CronJobManager
          enabled: true
        }
      ]
    }
  });

  await scheduler.initializeScheduler();
  scheduler.startScheduler();

  return { manager, scheduler };
}
```

### Worker Loop Lifecycle

```
[WAITING] ← Waiting for job signal
   ↓
   Signal received: job_id
   ↓
[CLAIMING] ← Try to update Pending → InProgress (atomic)
   ↓
   Successful? → YES → [EXECUTING] → Fetch entity → Call entity.run()
   │           NO → [WAITING]
   ↓
[COMPLETED/FAILED]
   ↓
   On error: Mark status Failed, continue
   ↓
[WAITING] ← Back to waiting for next job
```

### Error Handling

The CronJobManager has built-in error handling:

```typescript
// If claim fails (already claimed by another worker)
→ Skip job, move to next signal

// If entity fetch fails
→ Mark entity status as Failed, continue

// If entity.run() throws
→ Log error (entity handles retry/resumability), continue

// If loop crashes
→ Log error, retry after 5-second backoff
```

### Graceful Shutdown

```typescript
async function gracefulShutdown(manager: CronJobManager) {
  console.log('Shutting down job manager...');

  // Stop accepting new jobs
  await manager.stopWorkerLoop();

  // Wait for existing jobs to complete (entity responsibility)
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('Job manager stopped');
}
```

---

## Edge Types for Job Management

### EntityEdgeScheduledCall

**Links**: SchedulerNode → JobCallNode
**Meaning**: A cron tick triggered a job call

```typescript
// Created automatically when cron fires
const scheduledCallEdge = {
  from_node_id: schedulerNodeId,
  to_node_id: jobCallNodeId,
  specific_type_name: 'ScheduledCall',
  data: {
    trigger_time: new Date().toISOString()
  }
};
```

### EntityEdgeTriggersRun

**Links**: JobCallNode → RunnableEntity
**Meaning**: A job call created a work unit

```typescript
// Created by JobCallNode.run_impl()
const triggersRunEdge = {
  from_node_id: jobCallNodeId,
  to_node_id: runnableEntityId,
  specific_type_name: 'TriggersRun'
};
```

### EntityEdgeQueuedWork

**Links**: RunnableEntity → WorkQueueNode
**Meaning**: Work is queued for execution

```typescript
// Created by JobCallNode.run_impl()
const queuedWorkEdge = {
  from_node_id: runnableEntityId,
  to_node_id: workQueueNodeId,
  specific_type_name: 'QueuedWork'
};
```

### Querying Job History

```typescript
// Get all jobs triggered by a scheduler
// 'from' means edges where scheduler is the source (from_node_id)
const scheduledCallEdges = await scheduler.get_edges('from', 'ScheduledCall');
const jobCalls = await Promise.all(
  scheduledCallEdges.map(edge => edge.get_to())  // get_to() returns the target node
);

// Get work queued from a job call
const jobCall = await factory.get_entity(jobCallId);
const triggersRunEdges = await jobCall.get_edges('from', 'TriggersRun');
const workUnits = await Promise.all(
  triggersRunEdges.map(edge => edge.get_to())
);

// Trace complete job lifecycle
console.log('Scheduler → JobCall → RunnableEntity → Queue');
```

---

## Complete Patterns

### Pattern 1: Single-Replica, In-Process Queue

Best for development or simple deployments.

```typescript
import { EntityFactory } from '@firebrandanalytics/ff-agent-sdk/entity';

// Define a simple work entity
class DataBackupTask extends RunnableEntity<DataBackupRETH> {
  protected async *run_impl() {
    console.log('Starting backup...');
    // Perform backup work
    const backupResult = await performBackup(this.dto.data);
    return { backupId: backupResult.id };
  }
}

// Setup local queue
async function setupLocalQueue(factory: EntityFactory) {
  // 1. Create work queue
  const workQueue = await factory.create_entity_node({
    specific_type_name: 'WorkQueueNode',
    name: 'local-queue'
  });

  // 2. Start queue worker
  await workQueue.initializeQueue();
  await workQueue.startWorkerLoop();

  // 3. Create scheduler pointing to queue
  const scheduler = await factory.create_entity_node({
    specific_type_name: 'SchedulerNode',
    data: {
      jobs: [
        {
          job_id: 'daily-backup',
          cron_string: '0 2 * * *',              // 2 AM daily
          target_entity_type: 'DataBackupTask',
          input_data: { backup_scope: 'full' },
          work_queue_node_id: workQueue.id,
          enabled: true
        }
      ]
    }
  });

  await scheduler.initializeScheduler();
  scheduler.startScheduler();

  return { workQueue, scheduler };
}

// Usage
const factory = new EntityFactory();
const { workQueue, scheduler } = await setupLocalQueue(factory);

// Jobs will run automatically on schedule
```

### Pattern 2: Multi-Replica, Distributed Execution

Best for production deployments.

```typescript
import { CronJobManager } from '@firebrandanalytics/ff-agent-sdk/app';
import { RemoteEntityClient } from '@firebrandanalytics/ff-agent-sdk/client';

async function setupDistributedQueue(
  factory: EntityFactory,
  entityClient: RemoteEntityClient
) {
  // 1. Initialize distributed job manager
  const manager = CronJobManager.getInstance();
  manager.initialize(factory, entityClient);

  // 2. Start worker loop (each replica runs this independently)
  manager.startWorkerLoop();

  // 3. Create scheduler (any replica can be the scheduler)
  const scheduler = await factory.create_entity_node({
    specific_type_name: 'SchedulerNode',
    data: {
      jobs: [
        {
          job_id: 'process-orders',
          cron_string: '*/5 * * * *',             // Every 5 minutes
          target_entity_type: 'OrderProcessor',
          input_data: { max_batch_size: 100 },
          work_queue_node_id: 'ignored',          // CronJobManager uses direct signals
          enabled: true
        }
      ]
    }
  });

  await scheduler.initializeScheduler();
  scheduler.startScheduler();

  return { manager, scheduler };
}

// Usage (run on each replica)
const manager = await setupDistributedQueue(factory, entityClient);

// Jobs are safely distributed:
// - Scheduler fires cron tick
// - JobCallNode creates work unit
// - CronJobManager signals all replicas
// - First replica to claim wins atomically
// - Others move to next signal
```

### Pattern 3: Job Retry with Exponential Backoff

Entities handle retries automatically via RunnableEntity pattern.

```typescript
class RetryableJobEntity extends RunnableEntity<RetryableJobRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await performWork(dto.data);
        return result;
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;  // Final failure
        }

        // Backoff: wait 2^attempt seconds
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(`Attempt ${attempt} failed, retrying in ${delayMs}ms`);

        await sleep_promise(delayMs);
      }
    }
  }
}

// Or use WorkflowFault for more sophisticated retry strategies
class AdvancedRetryJob extends RunnableEntity<AdvancedRetryRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const retryCount = dto.data.retry_count ?? 0;

    if (retryCount >= 3) {
      return { status: 'failed', reason: 'max retries exceeded' };
    }

    try {
      const result = await performWork(dto.data);
      return { status: 'success', data: result };
    } catch (error) {
      // Reschedule with incremented retry count
      const rescheduleData = {
        ...dto.data,
        retry_count: retryCount + 1
      };

      await this.appendOrRetrieveCall(
        'RescheduleJob',
        `retry_${retryCount + 1}`,
        rescheduleData
      );

      throw error;
    }
  }
}
```

---

## Real-World Examples

### Example 1: Daily Email Report

```typescript
interface DailyReportData {
  recipients: string[];
  report_type: 'summary' | 'detailed';
}

class DailyEmailReport extends RunnableEntity<DailyReportRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const data = dto.data as DailyReportData;

    // Generate report
    const report = await generateReport(data.report_type);

    // Send emails
    for (const recipient of data.recipients) {
      await sendEmail({
        to: recipient,
        subject: `Daily ${data.report_type} Report`,
        body: formatReport(report)
      });
    }

    return {
      report_id: report.id,
      recipients_count: data.recipients.length,
      sent_at: new Date().toISOString()
    };
  }
}

// Schedule it
const scheduler = await factory.create_entity_node({
  specific_type_name: 'SchedulerNode',
  data: {
    jobs: [
      {
        job_id: 'morning-summary',
        cron_string: '0 8 * * MON-FRI',          // 8 AM on weekdays
        target_entity_type: 'DailyEmailReport',
        input_data: {
          recipients: ['team@company.com', 'mgmt@company.com'],
          report_type: 'summary'
        },
        work_queue_node_id: 'queue-id',
        timezone: 'America/New_York',
        enabled: true
      }
    ]
  }
});
```

### Example 2: Data Cleanup Task

```typescript
interface CleanupData {
  target_tables: string[];
  days_old: number;
}

class DataCleanupTask extends RunnableEntity<DataCleanupRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();
    const data = dto.data as CleanupData;

    const results = {
      tables_cleaned: [] as Array<{ table: string; rows_deleted: number }>
    };

    for (const table of data.target_tables) {
      const deletedCount = await deleteOldRecords(
        table,
        data.days_old
      );

      results.tables_cleaned.push({
        table,
        rows_deleted: deletedCount
      });

      console.log(`Cleaned ${table}: deleted ${deletedCount} rows`);
    }

    return results;
  }
}

// Schedule daily
const scheduler = await factory.create_entity_node({
  specific_type_name: 'SchedulerNode',
  data: {
    jobs: [
      {
        job_id: 'cleanup-old-logs',
        cron_string: '0 3 * * *',                // 3 AM daily
        target_entity_type: 'DataCleanupTask',
        input_data: {
          target_tables: ['event_logs', 'temp_sessions'],
          days_old: 30
        },
        work_queue_node_id: 'queue-id',
        enabled: true
      }
    ]
  }
});
```

### Example 3: Cascading Jobs

One job triggers another.

```typescript
class CascadingJobA extends RunnableEntity<CascadingARETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();

    console.log('Job A: Processing initial data');
    const intermediateResult = await processData(dto.data);

    // Create Job B with result from Job A
    const jobBEntity = await this.appendOrRetrieveCall(
      'CascadingJobB',
      'next-step',
      {
        input_from_a: intermediateResult,
        original_input: dto.data
      }
    );

    // Job B runs (either immediately or deferred)
    const finalResult = yield* jobBEntity.run();

    return { final_result: finalResult };
  }
}

class CascadingJobB extends RunnableEntity<CascadingBRETH> {
  protected async *run_impl() {
    const dto = await this.get_dto();

    console.log('Job B: Processing result from Job A');
    const finalOutput = await processIntermediate(dto.data.input_from_a);

    return { processed: finalOutput };
  }
}

// Schedule Job A only; Job B is triggered by Job A
const scheduler = await factory.create_entity_node({
  specific_type_name: 'SchedulerNode',
  data: {
    jobs: [
      {
        job_id: 'workflow-step-1',
        cron_string: '0 9 * * *',
        target_entity_type: 'CascadingJobA',
        input_data: { data: 'input' },
        work_queue_node_id: 'queue-id',
        enabled: true
      }
    ]
  }
});
```

---

## Troubleshooting

### Issue 1: Jobs Not Firing

**Problem**: Cron jobs aren't executing

**Checklist**:
- [ ] SchedulerNode.startScheduler() was called
- [ ] CronJobManager.startWorkerLoop() was called (for distributed)
- [ ] WorkQueueNode.startWorkerLoop() was called (for local queue)
- [ ] Cron expression is valid
- [ ] At least one job has enabled: true
- [ ] Current time matches cron schedule

**Solution**:
```typescript
// Verify scheduler is running
const dto = await scheduler.get_dto();
console.log('Jobs configured:', dto.data.jobs);
console.log('Enabled jobs:', dto.data.jobs.filter((j: any) => j.enabled));

// Check if manager is initialized
const manager = CronJobManager.getInstance();
console.log('Manager initialized:', manager.getIsInitialized());
console.log('Manager running:', manager.getIsRunning());
```

### Issue 2: Work Not Being Claimed

**Problem**: Jobs created but not executing

**Checklist**:
- [ ] WorkQueueNode or CronJobManager is running
- [ ] RunnableEntity status is 'Pending'
- [ ] QueuedWork edge exists (local) OR CronJobManager signals (distributed)
- [ ] Worker loop is not crashed

**Solution**:
```typescript
// Check entity status
const entity = await factory.get_entity(entityId);
const status = await entity.get_status();
console.log('Entity status:', status);  // Should be Pending

// Check queue has work
const queuedWorkEdges = await workQueue.get_edges('from', 'QueuedWork');
console.log('Jobs in queue:', queuedWorkEdges.length);

// Check worker loop status - try starting it
// startWorkerLoop() is safe to call if already running (will log warning)
console.log('Ensuring worker loop is running...');
await workQueue.startWorkerLoop();
```

### Issue 3: Job Executes Multiple Times

**Problem**: Same job running repeatedly

**Cause**: Possible race condition in distributed setup, or scheduler restarted

**Solution**:
```typescript
// Ensure JobCallNode naming is deterministic (automatic)
// JobCallNode uses: job:{job_id}:{timestampUTC}
// Multiple SchedulerNodes with same schedule on same tick = same timestamp = same ID = idempotent

// Check for duplicate JobCallNodes
const callNodes = await scheduler.get_edges('from', 'ScheduledCall');
console.log('Job calls:', callNodes.length);

// If duplicates exist, delete redundant ones
```

### Issue 4: Memory Leak from Signaling Buffer

**Problem**: WorkQueueNode memory usage grows

**Solution**:
```typescript
// Ensure work is being claimed and processed
const queuedWorkEdges = await workQueue.get_edges('from', 'QueuedWork');
console.log('Pending work:', queuedWorkEdges.length);

// If accumulating, ensure worker is running
// (safe to call even if already running)
await workQueue.startWorkerLoop();

// Or stop and restart queue
await workQueue.stopWorkerLoop();
await workQueue.stopQueue();
await workQueue.initializeQueue();
await workQueue.startWorkerLoop();
```

---

## Summary

Job scheduling in FireFoundry provides:

- **SchedulerNode**: Define cron schedules and job definitions
- **CronJobManager**: Distributed worker execution (multi-replica safe)
- **WorkQueueNode**: Local in-process queueing (single-replica)
- **Automatic resumability**: Jobs leverage RunnableEntity pattern
- **Edge-based history**: Track job lifecycle via graph edges

Key patterns:
1. Single replica → WorkQueueNode (simpler)
2. Multi replica → CronJobManager (distributed)
3. Cascading jobs → JobCallNode → RunnableEntity (composable)
4. Retry logic → RunnableEntity.run_impl() (resilient)
5. Tracing → Graph edges (observable)

For more information on RunnableEntity patterns, see [Entities Guide](../core/entities.md) and [Workflow Orchestration Guide](workflow_orchestration_guide.md).
