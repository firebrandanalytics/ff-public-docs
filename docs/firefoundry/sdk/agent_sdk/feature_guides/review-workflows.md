# Review Workflows: Human-in-the-Loop Feedback Iteration

Welcome to the comprehensive guide for implementing human-in-the-loop review workflows in the FireFoundry Agent SDK. This guide covers the complete review system for iterative feedback, approval workflows, and feedback-driven AI improvements.

## Table of Contents

1. [Overview and Concepts](#overview-and-concepts)
2. [Core Components](#core-components)
3. [Basic Review Workflow](#basic-review-workflow)
4. [Advanced Patterns](#advanced-patterns)
5. [Integration with Bots](#integration-with-bots)
6. [Human-in-the-Loop Patterns](#human-in-the-loop-patterns)
7. [Complete End-to-End Examples](#complete-end-to-end-examples)
8. [Common Workflows and Recipes](#common-workflows-and-recipes)
9. [Troubleshooting](#troubleshooting)

---

## Overview and Concepts

### Why Review Workflows?

In many agent-driven applications, AI-generated outputs require human validation before proceeding:

- **Quality Assurance**: A code review bot needs human approval before suggesting changes
- **Iterative Refinement**: A requirements extraction bot should incorporate reviewer feedback to improve results
- **Multi-Stage Approval**: A document generation workflow may require approvals at different stages
- **Human Authority**: Certain decisions should remain under human control with AI assistance

### The Review Loop

A review workflow follows this pattern:

```
1. AI generates initial result
   ↓
2. Human reviews and either:
   ├─ Approves (workflow complete)
   └─ Provides feedback
      ↓
3. AI processes feedback and regenerates result
   ↓
4. Repeat until approved
```

### Key Concepts

- **ReviewableEntity**: Orchestrates the entire review loop with iteration support
- **ReviewStep**: Represents a single review phase, waits for human input
- **Feedback Context**: Previous result and feedback passed to the AI in each iteration
- **Versioning**: Tracks which iteration of the result the reviewer is looking at
- **Named Entities**: Ensures idempotency - completed iterations won't re-run
- **Result Entities**: Optional persistent records of the final approved output

---

## Core Components

### ReviewableEntity

The `ReviewableEntity` class orchestrates human-in-the-loop review workflows with support for multiple feedback iterations.

#### What It Does

- **Iteration Management**: Runs a wrapped entity, gets human feedback, reruns with feedback, repeats until approved
- **Idempotency**: Uses named nodes (wrapped_0, wrapped_1, etc.) to ensure iterations complete exactly once
- **Feedback Context**: Automatically passes previous result and feedback to each iteration
- **Result Tracking**: Optionally creates result entities for storing approved outputs
- **Limbo Phase**: Optional post-approval phase for final checks

#### Core Methods

```typescript
// Main execution method - run the review workflow (generator)
protected async *run_impl(): AsyncGenerator<...>

// Get the current iteration version
getCurrentVersion(): number

// Update the version in persistent storage (protected)
protected updateVersion(): Promise<void>

// Create a result entity to store the approved output (protected)
protected createResultEntity(result: any): Promise<string>  // Returns entity ID

// Mark the result as approved (protected)
protected markResultAsApproved(resultEntityId: string): Promise<void>
```

Note: `updateVersion()`, `createResultEntity()`, and `markResultAsApproved()` are protected methods called internally by `run_impl()`. You typically don't need to call them directly.

#### Type Parameters

```typescript
ReviewableEntity<
  FeedbackType extends JSONCompatible<FeedbackType> | string = string
>
```

The `FeedbackType` parameter allows you to define structured feedback types:

```typescript
// Simple string feedback
class SimpleReviewWF extends ReviewableEntity<string> { }

// Structured feedback
interface RequirementsFeedback {
  missing_requirements: string[];
  quality_rating: 'low' | 'medium' | 'high';
  suggestions: string;
}

class RequirementsReviewWF extends ReviewableEntity<RequirementsFeedback> { }
```

#### Configuration

ReviewableEntity requires a `ReviewableConfig` in the constructor:

```typescript
interface ReviewableConfig<FeedbackType extends JSONCompatible<FeedbackType> | string = string> {
  // Entity instantiation
  wrappedEntityClassName?: string;     // Name of the wrapped entity class
  wrappedEntityClass?: new (...args: any[]) => any;  // Alternative: class reference

  // Review prompts
  reviewPrompt: string;                // Prompt for initial review phase
  limboPrompt?: string;                // Optional prompt for post-approval phase

  // Feedback processing
  feedbackTransform?: (rawFeedback: any) => FeedbackType;  // Transform feedback

  // Result tracking
  createResultEntity?: boolean;        // Create persistent result entities
  resultEntityTypeName?: string;       // Type name for result entities
  extractResultData?: (result: any) => any;  // Extract data for result creation
}
```

### ReviewStep

The `ReviewStep` class represents a single review phase where a human reviews an AI-generated result and provides feedback or approval.

#### What It Does

- **Waiting State**: Yields a waiting envelope to pause execution
- **Message Handling**: Receives human feedback or approval via messages
- **Feedback Storage**: Transforms and stores feedback data
- **Response Validation**: Processes and validates ReviewResponse

#### Core Methods

```typescript
// Main execution - yields to wait for review (generator)
protected async *run_impl(): AsyncGenerator<...>

// Handle incoming messages (approval or feedback) - protected
protected async *message_handler(message: string, data: any): AsyncGenerator<...>

// Approve the result - sends 'approved' message
approve(): void

// Provide feedback - sends 'feedback' message
giveFeedback(feedback: FeedbackType): void

// Get the appropriate prompt for this phase (protected)
protected getPromptForPhase(phase: 'initial' | 'limbo'): string
```

Note: `approve()` and `giveFeedback()` send messages to the waitable entity and return immediately. They do not wait for processing to complete.

#### ReviewStep Data Structure

```typescript
interface ReviewStepData<FeedbackType extends JSONCompatible<FeedbackType> | string = string> {
  parentWorkflowId: string;              // ID of parent ReviewableEntity
  wrappedEntityResult: any;              // Result to review
  previousFeedback?: FeedbackType;       // Feedback from previous iteration
  version: number;                       // Current iteration version
  resultEntityId?: string;               // ID of result entity if created
  phase: 'initial' | 'limbo';            // Review phase type
}
```

#### Review Response

```typescript
type ReviewResponse<FeedbackType> =
  | { message: 'approved'; data: boolean }      // Approved by reviewer
  | { message: 'feedback'; data: FeedbackType } // Feedback provided
```

### FeedbackRunnableEntityMixin

The `FeedbackRunnableEntityMixin` automatically injects feedback context into the wrapped entity's bot requests.

#### What It Does

- **Automatic Injection**: Injects feedback fields into bot request args in the pre-phase
- **Context Preservation**: Passes previous result and current version
- **Type-Safe**: Preserves your feedback type throughout the system

#### Injected Fields

When you use this mixin, the following fields are automatically added to your bot request `args`:

```typescript
interface InjectedFeedbackFields<FeedbackType> {
  _ff_feedback: FeedbackType;        // Feedback from the reviewer
  _ff_previous_result: any;          // Output from previous iteration
  _ff_version: number;               // Current iteration version
}
```

#### Usage Pattern

```typescript
// Entity receives feedback context from ReviewableEntity
class AnalysisEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin
)<[AnalysisRETH, BotRunnableEntityMixin<AnalysisRETH>, FeedbackRunnableEntityMixin<AnalysisRETH, AnalysisFeedback>]> {

  constructor(factory, idOrDto, analysisBot) {
    super(
      [[factory, idOrDto], []],  // RunnableEntity
      [analysisBot],              // BotRunnableEntityMixin
      []                          // FeedbackRunnableEntityMixin - no additional args
    );
  }

  protected async get_bot_request_args_impl(preArgs: any) {
    // preArgs.args already contains _ff_feedback, _ff_previous_result, _ff_version
    const dto = await this.get_dto();

    return {
      input: dto.data.text_to_analyze,
      args: {
        // _ff_feedback, _ff_previous_result, _ff_version already injected
        ...preArgs.args,
        // Add your own args here
      }
    };
  }
}
```

### FeedbackBotMixin

The `FeedbackBotMixin` adds bot-side support for processing feedback and previous results.

#### What It Does

- **Automatic Prompt Injection**: Adds feedback context to bot prompts
- **Flexible Feedback Handling**: Works with string or structured feedback
- **Conditional Display**: Shows feedback prompts only when feedback exists
- **Custom Prompts**: Allows custom feedback prompt templates

#### Configuration

```typescript
interface FeedbackMixinConfig<BTH extends BotTypeHelper<...>, FeedbackType> {
  feedbackPrompt?: Prompt<BTH['pth']>;           // Custom feedback prompt
  feedbackValidator?: PromptValidator<BTH['pth']>;  // Optional validator
  condition?: (request: PromptNodeRequest<BTH['pth']>) => boolean;  // When to show
  role?: 'system' | 'user';                      // Message role (default: 'system')
}
```

#### Usage Example

```typescript
class FeedbackAwareBot extends AddMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
) {
  constructor() {
    super({
      name: "AnalysisBot",
      schema: AnalysisOutputSchema,
      base_prompt_group: promptGroup,
      model_pool_name: "azure_completion_4o",
      // FeedbackBotMixin configuration
      feedbackPrompt: new PromptTemplateStringOrStructNode({
        semantic_type: 'guidance',
        content: 'Process the reviewer feedback to improve your analysis'
      }),
      role: 'system'
    });
  }
}
```

---

## Basic Review Workflow

### Step 1: Define Your Feedback Type

```typescript
// Simple string feedback
type SimpleFeedback = string;

// Or structured feedback
interface ReviewerFeedback {
  quality_score: 1 | 2 | 3 | 4 | 5;
  needs_improvement: string[];
  approved_sections: string[];
  general_comments: string;
}
```

### Step 2: Create Your Wrapped Entity

This is the entity that generates the AI output to be reviewed:

```typescript
import { AddMixins, RunnableEntity, BotRunnableEntityMixin, FeedbackRunnableEntityMixin } from '@firebrandanalytics/ff-agent-sdk/entity';
import { BotTypeHelper, ComposeMixins, MixinBot, StructuredOutputBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';

// Define the output schema
const AnalysisOutputSchema = z.object({
  summary: z.string(),
  key_points: z.array(z.string()),
  confidence: z.number().min(0).max(1)
});

type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

// Create the bot that generates the analysis
class AnalysisBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
) {
  constructor() {
    const systemPrompt = new Prompt({
      role: 'system',
      static_args: {},
    });
    systemPrompt.add_section(new PromptTemplateTextNode({
      content: 'You are an expert analyst. Analyze the provided content and return structured findings.',
    }));

    const inputPrompt = new Prompt({
      role: 'user',
      static_args: {},
    });
    inputPrompt.add_section(new PromptTemplateTextNode({
      content: (request) => request.input as string,
    }));

    const structuredPromptGroup = new StructuredPromptGroup({
      base: new PromptGroup([{ name: 'system', prompt: systemPrompt }]),
      input: new PromptGroup([{ name: 'user_input', prompt: inputPrompt }]),
    });

    super(
      [{ name: "AnalysisBot", base_prompt_group: structuredPromptGroup, model_pool_name: "azure_completion_4o", static_args: {} }],
      [{ schema: AnalysisOutputSchema }],
      [{}]  // FeedbackBotMixin config
    );
  }
}

// Create the entity that runs the bot
type AnalysisRETH = RunnableEntityTypeHelper<
  {
    text_to_analyze: string;
  },
  AnalysisOutput,
  unknown,
  unknown
>;

interface AnalysisEntityData extends FeedbackRequestArgs<ReviewerFeedback> {
  text_to_analyze: string;
}

class AnalysisEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin
)<[AnalysisRETH, BotRunnableEntityMixin<AnalysisRETH>, FeedbackRunnableEntityMixin<AnalysisRETH, ReviewerFeedback>]> {

  protected analysisBot: AnalysisBot;

  constructor(factory: EntityFactory, idOrDto: string | EntityDTO, analysisBot: AnalysisBot) {
    super(
      [[factory, idOrDto], []],
      [analysisBot],
      []
    );
    this.analysisBot = analysisBot;
  }

  protected async get_bot_request_args_impl(preArgs: any): Promise<BotRequestArgs<typeof AnalysisBot>> {
    const dto = await this.get_dto();
    const data = dto.data as AnalysisEntityData;

    return {
      input: data.text_to_analyze,
      args: {
        // Feedback context is automatically injected by FeedbackRunnableEntityMixin
        // in preArgs.args: _ff_feedback, _ff_previous_result, _ff_version
        ...preArgs.args
      }
    };
  }
}
```

### Step 3: Create Your ReviewableEntity

```typescript
class AnalysisReviewWorkflow extends ReviewableEntity<ReviewerFeedback> {
  constructor(factory: EntityFactory, idOrDto: string | EntityDTO) {
    super(factory, idOrDto, {
      // Specify the wrapped entity
      wrappedEntityClassName: 'AnalysisEntity',

      // Initial review prompt - shown to the first reviewer
      reviewPrompt: `
Please review the analysis provided by our AI analyst.

Consider:
- Is the summary accurate and concise?
- Are the key points comprehensive?
- Is the confidence score justified?

You can either approve or provide feedback for improvement.
      `,

      // Optional: Post-approval limbo phase for final verification
      limboPrompt: `
This analysis has been approved. Do you have any final checks or concerns?
      `,

      // Create persistent records of approved outputs
      createResultEntity: true,
      resultEntityTypeName: 'ApprovedAnalysis',
      extractResultData: (result: any) => ({
        summary: result.summary,
        key_points: result.key_points,
        confidence: result.confidence,
        approved_at: new Date().toISOString()
      }),

      // Optional: Transform raw feedback to your type
      feedbackTransform: (raw: any): ReviewerFeedback => ({
        quality_score: raw.quality_score ?? 3,
        needs_improvement: raw.needs_improvement ?? [],
        approved_sections: raw.approved_sections ?? [],
        general_comments: raw.general_comments ?? ''
      })
    });
  }
}
```

### Step 4: Running the Review Workflow

```typescript
async function runReviewWorkflow(textToAnalyze: string) {
  const factory = new EntityFactory();

  // Create the bot and wrapped entity
  const analysisBot = new AnalysisBot();

  // Create the workflow
  const workflow = new AnalysisReviewWorkflow(factory, {
    id: 'analysis-review-1',
    entity_type: 'AnalysisReviewWorkflow',
    data: {
      text_to_analyze: textToAnalyze,
      wrappedEntityClassName: 'AnalysisEntity',
      wrappedEntityArgs: {
        text_to_analyze: textToAnalyze
      },
      currentVersion: 1
    }
  });

  // Run the workflow
  const generator = workflow.run(new EntityRequest(workflow.entity));
  let result = await generator.next();

  // Step 1: AI generates initial analysis
  console.log('Step 1: AI generating analysis...');

  // The entity will run and generate an output, then yield a ReviewStep
  while (!result.done) {
    const envelope = result.value;

    if (envelope.envelope_type === 'WAITING') {
      // A ReviewStep is waiting for human feedback
      console.log('Step 2: Waiting for reviewer feedback...');
      console.log('Current version:', workflow.getCurrentVersion());
      console.log('Previous result:', envelope.data.wrappedEntityResult);

      // Simulate reviewer feedback
      const reviewerFeedback: ReviewerFeedback = {
        quality_score: 4,
        needs_improvement: ['Expand the confidence explanation'],
        approved_sections: ['summary', 'key_points'],
        general_comments: 'Good analysis, needs one refinement'
      };

      // Send feedback back to continue the workflow
      result = await generator.next({
        message: 'feedback',
        data: reviewerFeedback
      });

      console.log('Step 3: Sending feedback and re-running analysis...');
    } else {
      result = await generator.next();
    }
  }

  // Workflow complete
  const finalResult = result.value;
  console.log('Workflow complete!');
  console.log('Final result:', finalResult.output);
  console.log('Final version:', finalResult.output.finalVersion);
  console.log('Result entity ID:', finalResult.output.resultEntityId);
}
```

---

## Advanced Patterns

### Pattern 1: Conditional Feedback with Structured Types

Create feedback types that guide reviewers:

```typescript
// Discriminated feedback types
type ReviewerFeedback =
  | { type: 'approved'; notes?: string }
  | { type: 'needs_changes'; priority: 'high' | 'medium' | 'low'; description: string }
  | { type: 'reject'; reason: string }
  | { type: 'request_alternative'; alternative_approach: string };

// Use Zod for validation
const ReviewerFeedbackSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('approved'), notes: z.string().optional() }),
  z.object({ type: z.literal('needs_changes'), priority: z.enum(['high', 'medium', 'low']), description: z.string() }),
  z.object({ type: z.literal('reject'), reason: z.string() }),
  z.object({ type: z.literal('request_alternative'), alternative_approach: z.string() })
]);

class AdvancedReviewWorkflow extends ReviewableEntity<ReviewerFeedback> {
  constructor(factory: EntityFactory, idOrDto: string | EntityDTO) {
    super(factory, idOrDto, {
      wrappedEntityClassName: 'AnalysisEntity',
      reviewPrompt: 'Review and provide structured feedback',
      feedbackTransform: (raw: any): ReviewerFeedback => {
        const validated = ReviewerFeedbackSchema.parse(raw);
        return validated;
      }
    });
  }

  // Override to handle different feedback types
  protected async processFeedback(feedback: ReviewerFeedback): Promise<boolean> {
    switch (feedback.type) {
      case 'approved':
        return true;  // Continue to completion
      case 'reject':
        throw new Error(`Review rejected: ${feedback.reason}`);
      case 'needs_changes':
        return false;  // Continue iteration
      case 'request_alternative':
        // Handle alternative approach request
        return false;
    }
  }
}
```

### Pattern 2: Multiple Review Phases

```typescript
interface MultiphaseReviewConfig {
  phase1Reviewers: string[];      // Initial review
  phase2Reviewers: string[];      // Quality assurance
  phase3Reviewers: string[];      // Final approval
}

class MultiphaseReviewWorkflow extends ReviewableEntity<ReviewerFeedback> {
  private currentPhase: 1 | 2 | 3 = 1;

  constructor(factory: EntityFactory, idOrDto: string | EntityDTO, config: MultiphaseReviewConfig) {
    super(factory, idOrDto, {
      wrappedEntityClassName: 'AnalysisEntity',
      reviewPrompt: `Phase ${this.currentPhase} Review`,
      limboPrompt: 'Next phase review incoming...'
    });
  }

  protected getReviewPromptForPhase(): string {
    switch (this.currentPhase) {
      case 1:
        return 'Phase 1: Does the analysis address all requirements?';
      case 2:
        return 'Phase 2: Quality check - are there any factual errors?';
      case 3:
        return 'Phase 3: Final approval - is this ready for publication?';
    }
  }
}
```

### Pattern 3: Automatic Fallback on Repeated Feedback

```typescript
class RobustReviewWorkflow extends ReviewableEntity<ReviewerFeedback> {
  private maxIterations = 5;
  private iteration = 0;

  protected async shouldContinueIteration(feedback: ReviewerFeedback): Promise<boolean> {
    this.iteration++;

    if (this.iteration >= this.maxIterations) {
      // After max iterations, accept result even without full approval
      console.warn(`Max iterations (${this.maxIterations}) reached. Accepting result.`);
      return false;
    }

    return true;
  }
}
```

### Pattern 4: Quality Scoring with Feedback Aggregation

```typescript
interface QualityFeedback {
  scores: {
    accuracy: 1 | 2 | 3 | 4 | 5;
    completeness: 1 | 2 | 3 | 4 | 5;
    clarity: 1 | 2 | 3 | 4 | 5;
  };
  comments: string;
}

class QualityGatedReviewWorkflow extends ReviewableEntity<QualityFeedback> {
  private minimumAverageScore = 4.0;

  protected isQualityAcceptable(feedback: QualityFeedback): boolean {
    const average = (
      feedback.scores.accuracy +
      feedback.scores.completeness +
      feedback.scores.clarity
    ) / 3;

    return average >= this.minimumAverageScore;
  }
}
```

---

## Integration with Bots

### Pattern 1: Bot Receives Feedback Context

Your bot can use feedback to improve its output:

```typescript
class ImprovedAnalysisBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
) {
  constructor() {
    const feedbackPrompt = new PromptTemplateSectionNode({
      semantic_type: 'guidance',
      content: 'Feedback from reviewer:',
      children: [
        'If this is your first attempt (_ff_version is 1), provide thorough analysis.',
        'If this is a revision (_ff_version > 1), the reviewer provided feedback: {_ff_feedback}',
        'Your previous attempt was: {_ff_previous_result}',
        'Incorporate the feedback and improve your analysis.'
      ]
    });

    super({
      name: "ImprovedAnalysisBot",
      schema: AnalysisOutputSchema,
      base_prompt_group: promptGroup,
      model_pool_name: "azure_completion_4o",
      feedbackPrompt: feedbackPrompt
    });
  }
}
```

### Pattern 2: Conditional Bot Behavior Based on Iteration

```typescript
class ContextAwareEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin
)<[AnalysisRETH, BotRunnableEntityMixin<AnalysisRETH>, FeedbackRunnableEntityMixin<AnalysisRETH, ReviewerFeedback>]> {

  protected async get_bot_request_args_impl(preArgs: any): Promise<BotRequestArgs<typeof AnalysisBot>> {
    const dto = await this.get_dto();
    const data = dto.data as AnalysisEntityData;
    const version = data._ff_version ?? 1;

    // Adjust behavior based on iteration
    const systemPromptAddition = version === 1
      ? 'Provide a comprehensive initial analysis.'
      : `The reviewer provided this feedback: "${data._ff_feedback}". Focus your revision on addressing this feedback.`;

    return {
      input: data.text_to_analyze,
      args: {
        ...preArgs.args,
        iteration_number: version,
        is_revision: version > 1
      }
    };
  }
}
```

---

## Human-in-the-Loop Patterns

### Pattern 1: Waiting for Human Input

The `ReviewStep` entity yields a `WAITING` envelope when it needs human input:

```typescript
// In your workflow runner
const generator = workflow.run(request);
let result = await generator.next();

while (!result.done) {
  const envelope = result.value;

  if (envelope.envelope_type === 'WAITING') {
    // Pause execution and wait for external input
    const userId = envelope.data.userId;
    const reviewableContent = envelope.data.wrappedEntityResult;

    console.log(`Waiting for review by user ${userId}`);
    console.log(`Content: ${JSON.stringify(reviewableContent, null, 2)}`);

    // Wait for user to provide input
    const userInput = await getUserInputFromUI(userId);

    // Resume execution with user input
    result = await generator.next(userInput);
  } else {
    result = await generator.next();
  }
}
```

### Pattern 2: Web UI for Review

```typescript
// Backend workflow runner
async function startReview(workflowId: string) {
  const workflow = await loadWorkflow(workflowId);
  const generator = workflow.run(request);

  let result = await generator.next();

  while (!result.done) {
    if (result.value?.envelope_type === 'WAITING') {
      // Store waiting state
      const waitingState = {
        workflowId,
        generator: generator,  // Can't directly serialize
        envelope: result.value
      };

      // Send content to UI
      publishToUI({
        type: 'review_needed',
        workflowId,
        content: result.value.data.wrappedEntityResult,
        version: result.value.data.version,
        reviewPrompt: result.value.data.phase === 'initial'
          ? config.reviewPrompt
          : config.limboPrompt
      });

      // Exit loop - wait for user submission
      break;
    }

    result = await generator.next();
  }
}

// UI endpoint for submitting review
app.post('/api/reviews/:workflowId/submit', async (req, res) => {
  const { workflowId } = req.params;
  const { decision, feedback } = req.body;  // 'approved' or 'feedback'

  // Resume the workflow
  const workflow = await loadWorkflow(workflowId);
  const reviewResponse = decision === 'approved'
    ? { message: 'approved', data: true }
    : { message: 'feedback', data: feedback };

  const generator = await resumeGenerator(workflowId);
  const result = await generator.next(reviewResponse);

  // Continue running if not done
  let current = result;
  while (!current.done && current.value?.envelope_type !== 'WAITING') {
    current = await generator.next();
  }

  if (current.done) {
    res.json({ status: 'complete', result: current.value });
  } else {
    res.json({ status: 'waiting', version: current.value.data.version });
  }
});
```

### Pattern 3: Async Notification System

```typescript
class NotificationAwareReviewWorkflow extends ReviewableEntity<ReviewerFeedback> {
  async onWaitingForReview(reviewData: ReviewStepData) {
    // Send notification to reviewer
    await notificationService.send({
      userId: reviewData.reviewerId,
      title: 'Review Needed',
      message: `Version ${reviewData.version} is ready for review`,
      link: `/reviews/${reviewData.parentWorkflowId}`,
      priority: 'high'
    });

    // Optional: Set reminder
    if (reviewData.version === 1) {
      // First review - more urgent
      await reminderService.schedule({
        userId: reviewData.reviewerId,
        delay: '1 hour',
        message: 'Reminder: Review needed'
      });
    }
  }
}
```

---

## Complete End-to-End Examples

### Example 1: Requirements Document Review Workflow

```typescript
// Define feedback type
interface RequirementsFeedback {
  status: 'approved' | 'needs_revision' | 'incomplete';
  missing_requirements: string[];
  ambiguous_sections: string[];
  technical_concerns: string[];
  reviewer_name: string;
}

// Create bot that generates requirements
const RequirementsOutputSchema = z.object({
  requirements: z.array(z.object({
    id: z.string(),
    description: z.string(),
    priority: z.enum(['critical', 'high', 'medium', 'low']),
    acceptance_criteria: z.array(z.string())
  })),
  scope: z.string(),
  assumptions: z.array(z.string())
});

class RequirementsBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
) {
  constructor() {
    const systemPrompt = new PromptTemplateStringOrStructNode({
      semantic_type: 'system',
      content: `You are a requirements engineer. Generate clear, specific, measurable requirements.

When revising based on feedback:
- Address all missing requirements
- Clarify ambiguous sections
- Mitigate technical concerns
- Maintain consistency with approved sections`
    });

    const inputPrompt = new Prompt({
      role: 'user',
      static_args: {},
    });
    inputPrompt.add_section(new PromptTemplateTextNode({
      content: (request) => request.input as string,
    }));

    const structuredPromptGroup = new StructuredPromptGroup({
      base: new PromptGroup([{ name: 'system', prompt: systemPrompt }]),
      input: new PromptGroup([{ name: 'input', prompt: inputPrompt }]),
    });

    super(
      [{ name: "RequirementsBot", base_prompt_group: structuredPromptGroup, model_pool_name: "azure_completion_4o", static_args: {} }],
      [{ schema: RequirementsOutputSchema }]
    );
  }
}

// Create the requirements entity
type RequirementsRETH = RunnableEntityTypeHelper<
  { project_description: string },
  z.infer<typeof RequirementsOutputSchema>,
  unknown,
  unknown
>;

interface RequirementsEntityData extends FeedbackRequestArgs<RequirementsFeedback> {
  project_description: string;
}

class RequirementsEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin
)<[RequirementsRETH, BotRunnableEntityMixin<RequirementsRETH>, FeedbackRunnableEntityMixin<RequirementsRETH, RequirementsFeedback>]> {

  constructor(factory: EntityFactory, idOrDto: string | EntityDTO, requirementsBot: RequirementsBot) {
    super(
      [[factory, idOrDto], []],
      [requirementsBot],
      []
    );
  }

  protected async get_bot_request_args_impl(preArgs: any): Promise<BotRequestArgs<typeof RequirementsBot>> {
    const dto = await this.get_dto();
    const data = dto.data as RequirementsEntityData;

    return {
      input: data.project_description,
      args: {
        ...preArgs.args,
        version: data._ff_version,
        is_revision: data._ff_version > 1
      }
    };
  }
}

// Create the review workflow
class RequirementsReviewWorkflow extends ReviewableEntity<RequirementsFeedback> {
  constructor(factory: EntityFactory, idOrDto: string | EntityDTO) {
    super(factory, idOrDto, {
      wrappedEntityClassName: 'RequirementsEntity',
      reviewPrompt: `
Please review the requirements document.

Check for:
1. Clarity - Are requirements clear and unambiguous?
2. Completeness - Are all aspects covered?
3. Measurability - Can success be measured?
4. Technical feasibility - Are they implementable?

Provide feedback or approve.
      `,
      createResultEntity: true,
      resultEntityTypeName: 'ApprovedRequirementsDoc',
      extractResultData: (result: any) => ({
        requirements_count: result.requirements.length,
        scope: result.scope,
        critical_count: result.requirements.filter((r: any) => r.priority === 'critical').length,
        high_priority_count: result.requirements.filter((r: any) => r.priority === 'high').length
      })
    });
  }
}

// Run the workflow
async function runRequirementsReview(projectDescription: string) {
  const factory = new EntityFactory();
  const bot = new RequirementsBot();

  const workflow = new RequirementsReviewWorkflow(factory, {
    id: `req-review-${Date.now()}`,
    entity_type: 'RequirementsReviewWorkflow',
    data: {
      project_description: projectDescription,
      wrappedEntityClassName: 'RequirementsEntity',
      wrappedEntityArgs: { project_description: projectDescription },
      currentVersion: 1
    }
  });

  const generator = workflow.run(new EntityRequest(workflow.entity));
  let result = await generator.next();
  let iterationCount = 0;

  while (!result.done) {
    const envelope = result.value;

    if (envelope.envelope_type === 'WAITING') {
      iterationCount++;
      console.log(`\n=== Iteration ${iterationCount} - Waiting for Reviewer ===`);
      console.log(`Generated Requirements:\n${JSON.stringify(envelope.data.wrappedEntityResult, null, 2)}`);

      // Simulate reviewer input
      if (iterationCount === 1) {
        // First review - request changes
        const feedback: RequirementsFeedback = {
          status: 'needs_revision',
          missing_requirements: [
            'Performance requirements for API response times',
            'Data security and encryption requirements'
          ],
          ambiguous_sections: [
            'The "robust error handling" requirement needs specifics'
          ],
          technical_concerns: [
            'Database scalability requirements not mentioned'
          ],
          reviewer_name: 'Alice (Product Manager)'
        };

        console.log(`\nReviewer feedback: ${JSON.stringify(feedback, null, 2)}`);
        result = await generator.next({ message: 'feedback', data: feedback });
      } else {
        // Second review - approve
        const approval: ReviewerFeedback = {
          status: 'approved',
          missing_requirements: [],
          ambiguous_sections: [],
          technical_concerns: [],
          reviewer_name: 'Bob (Tech Lead)'
        };

        console.log(`\nReviewer approval: ${JSON.stringify(approval, null, 2)}`);
        result = await generator.next({ message: 'approved', data: true });
      }
    } else {
      result = await generator.next();
    }
  }

  console.log(`\n=== Workflow Complete ===`);
  console.log(`Final Requirements:\n${JSON.stringify(result.value.output, null, 2)}`);
  console.log(`Total iterations: ${iterationCount}`);
}
```

### Example 2: Code Review Approval Workflow

```typescript
// Feedback type for code reviews
interface CodeReviewFeedback {
  decision: 'approve' | 'request_changes' | 'comment';
  severity: 'critical' | 'major' | 'minor' | 'style';
  issues: Array<{
    file: string;
    line: number;
    issue_type: 'bug' | 'performance' | 'security' | 'style' | 'documentation';
    description: string;
    suggested_fix?: string;
  }>;
  summary: string;
}

// Output schema for code review bot
const CodeReviewSchema = z.object({
  files_reviewed: z.array(z.string()),
  total_issues_found: z.number(),
  critical_issues: z.number(),
  approved: z.boolean(),
  summary: z.string(),
  recommendations: z.array(z.string())
});

// Bot that performs code review
class CodeReviewBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin,
  FeedbackBotMixin
) {
  constructor() {
    super({
      name: "CodeReviewBot",
      schema: CodeReviewSchema,
      base_prompt_group: buildCodeReviewPromptGroup(),
      model_pool_name: "azure_completion_4o"
    });
  }
}

// Entity that runs the code review bot
class CodeReviewEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,
  FeedbackRunnableEntityMixin
)<[CodeReviewRETH, BotRunnableEntityMixin<CodeReviewRETH>, FeedbackRunnableEntityMixin<CodeReviewRETH, CodeReviewFeedback>]> {

  protected async get_bot_request_args_impl(preArgs: any): Promise<BotRequestArgs<typeof CodeReviewBot>> {
    const dto = await this.get_dto();
    const data = dto.data as CodeReviewEntityData;

    // If this is a revision, include the review feedback
    if (data._ff_version > 1) {
      const feedback = data._ff_feedback as CodeReviewFeedback;
      return {
        input: data.code_to_review,
        args: {
          ...preArgs.args,
          review_feedback: feedback.summary,
          issues_to_address: feedback.issues.map(i => i.description),
          previous_review: data._ff_previous_result
        }
      };
    }

    return {
      input: data.code_to_review,
      args: preArgs.args
    };
  }
}

// Workflow that manages the code review process
class CodeReviewApprovalWorkflow extends ReviewableEntity<CodeReviewFeedback> {
  constructor(factory: EntityFactory, idOrDto: string | EntityDTO) {
    super(factory, idOrDto, {
      wrappedEntityClassName: 'CodeReviewEntity',
      reviewPrompt: `
Please review the AI-generated code review. As the human reviewer:

1. Verify the AI found all critical issues
2. Check if the analysis is accurate
3. Decide if the code is approvable

You can:
- Approve the review (code is ready)
- Request changes (more issues need addressing)
- Add comments for the developer

If you request changes, describe the additional issues found.
      `,
      limboPrompt: 'Final review - any last concerns before merging?',
      createResultEntity: true,
      resultEntityTypeName: 'ApprovedCodeReview'
    });
  }
}

// Run workflow
async function approveCodeReview(codeToReview: string, prNumber: number) {
  const factory = new EntityFactory();
  const bot = new CodeReviewBot();

  const workflow = new CodeReviewApprovalWorkflow(factory, {
    id: `pr-review-${prNumber}`,
    entity_type: 'CodeReviewApprovalWorkflow',
    data: {
      code_to_review: codeToReview,
      pr_number: prNumber,
      wrappedEntityClassName: 'CodeReviewEntity',
      wrappedEntityArgs: { code_to_review: codeToReview },
      currentVersion: 1
    }
  });

  const generator = workflow.run(new EntityRequest(workflow.entity));
  let result = await generator.next();

  // Process the workflow
  // ... (similar iteration logic as requirements example)
}
```

---

## Common Workflows and Recipes

### Recipe 1: Multi-Step Approval with Escalation

```typescript
class EscalatingReviewWorkflow extends ReviewableEntity<ReviewerFeedback> {
  private escalationLevel = 0;
  private maxEscalation = 2;

  protected async shouldEscalate(): Promise<boolean> {
    if (this.escalationLevel >= this.maxEscalation) return false;
    this.escalationLevel++;
    return true;
  }

  getReviewPromptForLevel(): string {
    switch (this.escalationLevel) {
      case 0:
        return 'Initial review by team lead';
      case 1:
        return 'Escalated: Director review required';
      case 2:
        return 'Final escalation: Executive approval';
      default:
        return 'Review required';
    }
  }
}
```

### Recipe 2: Consensus-Based Approval

```typescript
interface ConsensusReview {
  reviewer_id: string;
  decision: 'approve' | 'reject' | 'abstain';
  feedback: string;
}

class ConsensusReviewWorkflow extends ReviewableEntity<ConsensusReview[]> {
  private requiredReviewers = ['reviewer_1', 'reviewer_2', 'reviewer_3'];
  private reviews: Map<string, ConsensusReview> = new Map();

  protected isConsensusReached(): boolean {
    const approvals = Array.from(this.reviews.values()).filter(r => r.decision === 'approve').length;
    const threshold = Math.ceil(this.requiredReviewers.length / 2);  // Majority
    return approvals >= threshold;
  }
}
```

### Recipe 3: Time-Bounded Review

```typescript
class TimeBoundedReviewWorkflow extends ReviewableEntity<ReviewerFeedback> {
  private startTime = Date.now();
  private timeoutMs = 24 * 60 * 60 * 1000;  // 24 hours

  protected isTimeoutExceeded(): boolean {
    return Date.now() - this.startTime > this.timeoutMs;
  }

  protected async handleTimeout(): Promise<void> {
    console.warn('Review timeout exceeded. Proceeding with default approval.');
    // Auto-approve or escalate based on policy
  }
}
```

### Recipe 4: A/B Testing Different Review Prompts

```typescript
class ABTestedReviewWorkflow extends ReviewableEntity<ReviewerFeedback> {
  private variant: 'A' | 'B';

  constructor(factory: EntityFactory, idOrDto: string | EntityDTO, variant: 'A' | 'B') {
    super(factory, idOrDto, {
      reviewPrompt: variant === 'A'
        ? 'Please review and provide feedback'  // Simple
        : 'Please review against these criteria: accuracy, completeness, clarity. Rate 1-5 for each.'  // Structured
    });
    this.variant = variant;
  }

  async trackMetrics(result: ReviewableResult): Promise<void> {
    await metricsService.recordReviewMetrics({
      variant: this.variant,
      iterations: result.finalVersion,
      approvalTime: result.approval_time_ms,
      feedbackQuality: result.feedback_quality_score
    });
  }
}
```

---

## Troubleshooting

### Issue 1: "Entity not found" When Creating Result Entity

**Problem**: Creating a result entity fails with "Entity type not registered"

**Solution**:
```typescript
// Ensure the result entity type is registered in FFConstructors
const FFConstructors = {
  'ApprovedAnalysis': ApprovedAnalysisEntity,  // Register here
  'ReviewableEntity': ReviewableEntity,
  'ReviewStep': ReviewStep
};

// Pass to factory
const factory = new EntityFactory({ constructors: FFConstructors });
```

### Issue 2: Feedback Not Being Passed to Bot

**Problem**: Bot doesn't receive `_ff_feedback`, `_ff_previous_result`, `_ff_version`

**Solution**:
```typescript
// Ensure FeedbackRunnableEntityMixin is composed AFTER BotRunnableEntityMixin
class CorrectOrderEntity extends AddMixins(
  RunnableEntity,
  BotRunnableEntityMixin,        // First
  FeedbackRunnableEntityMixin    // Second (pre-phase runs after)
) { }

// Verify in get_bot_request_args_impl
protected async get_bot_request_args_impl(preArgs: any) {
  console.log('preArgs.args:', preArgs.args);  // Should contain _ff_feedback
  return { input: 'test', args: preArgs.args };
}
```

### Issue 3: Workflow Doesn't Wait for Human Input

**Problem**: Workflow completes without waiting for review

**Solution**:
```typescript
// Ensure ReviewStep is yielded (check ReviewableEntity configuration)
const config: ReviewableConfig = {
  wrappedEntityClassName: 'MyEntity',  // Must be set
  reviewPrompt: 'Please review',        // Must be set
  // createResultEntity optional, but should be set for persistence
};

// Check that wrapped entity completes successfully before review
// If wrapped entity throws error, review won't happen
try {
  const wrappedResult = await wrappedEntity.run(request);
  // Only if successful, ReviewStep will be created
} catch (e) {
  console.error('Wrapped entity failed:', e);
}
```

### Issue 4: Repeated Iterations Not Improving Output

**Problem**: Feedback provided but bot output stays the same

**Solution**:
```typescript
// Ensure bot prompt mentions feedback and previous result
const feedbackPrompt = new PromptTemplateSectionNode({
  content: `
If this is a revision (indicated by _ff_version > 1):
- The reviewer provided feedback: {_ff_feedback}
- Your previous output was: {_ff_previous_result}
- Incorporate the feedback to improve your output
  `
});

// Verify FeedbackBotMixin is using this prompt
super({
  name: "BotWithFeedback",
  feedbackPrompt: feedbackPrompt,
  role: 'system'  // Ensure it's being added
});
```

### Issue 5: Named Nodes Creating Duplicates

**Problem**: Multiple wrapped_0, wrapped_1, etc. entities being created unnecessarily

**Solution**:
```typescript
// Ensure you're using the same ReviewableEntity instance across iterations
const workflow = await factory.getOrCreateEntity('my-review-workflow');
const generator = workflow.run(request);

// Don't create new ReviewableEntity for each iteration - reuse it
// The named node system (wrapped_0, wrapped_1) handles versioning automatically

// Verify named nodes are being reused
const allNodes = await entity.getChildren();
const wrappedNodes = allNodes.filter(n => n.name.startsWith('wrapped_'));
console.log('Named nodes:', wrappedNodes.map(n => n.name));  // Should be: wrapped_0, wrapped_1, wrapped_2, etc.
```

### Issue 6: Feedback Type Mismatch

**Problem**: TypeScript error about feedback type mismatch

**Solution**:
```typescript
// Ensure feedback type is consistent throughout
interface MyFeedback {
  approved: boolean;
  notes: string;
}

// Entities must use same type
class MyEntity extends AddMixins(
  RunnableEntity,
  FeedbackRunnableEntityMixin<SomeRETH, MyFeedback>  // Specify type here
) { }

// Workflow must use same type
class MyWorkflow extends ReviewableEntity<MyFeedback> {
  constructor(factory, idOrDto) {
    super(factory, idOrDto, {
      feedbackTransform: (raw: any): MyFeedback => ({
        approved: raw.approved ?? false,
        notes: raw.notes ?? ''
      })
    });
  }
}

// Usage must match
const response: ReviewResponse<MyFeedback> = {
  message: 'feedback',
  data: { approved: false, notes: 'Needs revision' }  // Correct type
};
```

---

## Summary

Review workflows enable powerful human-in-the-loop applications:

- **ReviewableEntity**: Orchestrates multi-iteration feedback loops with named entities for idempotency
- **ReviewStep**: Waits for human input, processes feedback or approval
- **FeedbackRunnableEntityMixin**: Automatically injects feedback context into bot requests
- **FeedbackBotMixin**: Adds bot-side support for processing feedback
- **Result Entities**: Persist approved outputs for reference and auditing

Key patterns:
1. Define your feedback type (string or structured)
2. Create a wrapped entity that uses FeedbackRunnableEntityMixin
3. Create a bot that uses FeedbackBotMixin
4. Create a ReviewableEntity with configuration
5. Run the workflow and handle WAITING envelopes to get human input

For more advanced patterns, see examples for requirements documents, code reviews, consensus-based approval, and time-bounded workflows.
