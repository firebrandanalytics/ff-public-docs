# Entity Modeling Tutorial: Mapping Problems to the Graph

### Introduction

Before you write a single line of FireFoundry code, you must design your model. A well-designed Entity Graph makes development feel natural and intuitive; a poorly designed one can lead to fighting the framework.

This tutorial will teach you how to **think in graphs**. We will walk through three examples, starting with a simple data structure and progressing to a complex, dynamic AI agent. The goal is to give you a repeatable process for mapping real-world problems to FireFoundry entities and edges.

There is no code in this guide. The goal is to learn the art of modeling on a whiteboard first.

---

### The 4-Step Modeling Process

Modeling a problem as a graph can be broken down into a simple, repeatable process. For any new feature or application, always start with these four steps:

1.  **Identify the Nouns:** What are the core objects, concepts, or pieces of data in your problem domain? These are your **Entity** candidates.
2.  **Identify the Verbs:** How do these nouns relate to each other? What actions connect them? These are your **Edge** candidates (e.g., `Contains`, `Owns`, `Calls`, `RespondsTo`).
3.  **Identify the "Doers":** Which of your entities represent a process, a task, an operation, or a workflow that runs over time? These are your **Runnable Entity** candidates. They are the active parts of your system.
4.  **Sketch the Graph:** Get away from your keyboard. On a whiteboard or a piece of paper, draw circles for your Entities and labeled arrows for your Edges. This simple act will clarify your design more than anything else.

Let's apply this process to a few examples.

---

### Example 1: A Simple Q&A System

**Problem:** We need to build a simple chat application. Users have conversations with an AI. Each user message gets a corresponding AI answer.

#### Step 1: Identify the Nouns
The core objects are straightforward:
*   `User`
*   `Conversation`
*   `UserMessage`
*   `AssistantAnswer`

#### Step 2: Identify the Verbs
How do these objects relate?
*   A `User` **Owns** a `Conversation`.
*   A `Conversation` **Contains** both `UserMessages` and `AssistantAnswers`.
*   An `AssistantAnswer` **RespondsTo** a specific `UserMessage`.

#### Step 3: Identify the "Doers"
What is the active part of this system? The process of generating an answer. While the `AssistantAnswer` is the *result*, the *act* of generating it is a task. Let's model this explicitly.
*   `AnswerGenerationTask`: This will be our **Runnable Entity**.

This gives us a new relationship: a `UserMessage` **Calls** an `AnswerGenerationTask`.

#### Step 4: Sketch the Graph
Now, let's draw it.

*   Draw a `User` entity.
*   Draw an `Owns` edge from `User` to a `Conversation` entity.
*   Draw `Contains` edges from the `Conversation` to several `UserMessage` and `AssistantAnswer` entities.
*   For a specific `UserMessage`, draw a `Calls` edge to an `AnswerGenerationTask` entity.
*   The `AnswerGenerationTask` produces the `AssistantAnswer`, which is then linked back to the `Conversation` and the original `UserMessage`.

This simple, linear graph clearly shows the flow of data and invocation.

---

### Example 2: A Document Approval Workflow

**Problem:** An author submits a document. It must be reviewed by one or more reviewers, who can leave comments. The author can then revise. Finally, an editor gives final approval.

#### Step 1: Identify the Nouns
*   `User` (we should probably note they can have roles: Author, Reviewer, Editor)
*   `Document`
*   `ApprovalRequest`
*   `Comment`

#### Step 2: Identify the Verbs
*   An `Author` (**User**) **Submits** a `Document`.
*   A `Document` **HasAn** `ApprovalRequest`.
*   An `ApprovalRequest` **IsAssignedTo** one or more `Reviewers` (**Users**).
*   `Reviewers` **Add** `Comments` to the `ApprovalRequest`.
*   An `Editor` (**User**) **Approves** or **Rejects** the `ApprovalRequest`.

#### Step 3: Identify the "Doers"
The central "doer" here is the workflow itself. The `ApprovalRequest` isn't just a piece of data; it *is* the process.
*   `ApprovalRequest`: This is the perfect **Runnable Entity**. Its internal status (`PendingReview`, `RevisionsRequested`, `Approved`, `Rejected`) perfectly mirrors the real-world state of the workflow.

Furthermore, this workflow needs to pause and wait for human input. This makes the `ApprovalRequest` a candidate for a special type of runnable called a **Waitable Entity**.

#### Step 4: Sketch the Graph
This graph looks different from the first one.

*   Draw the `Document` and the `Author` who submitted it.
*   The `Document` has a single `HasAn` edge pointing to the central `ApprovalRequest` entity.
*   The `ApprovalRequest` is the hub. Draw `IsAssignedTo` edges from it pointing to several `Reviewer` entities.
*   Draw `Adds` edges from those `Reviewers` back to `Comment` entities, which are then linked to the `ApprovalRequest`.
*   An `Editor` is also linked via an `Approves` edge.

The sketch reveals a hub-and-spoke pattern, with the stateful `ApprovalRequest` entity at the center, coordinating all the actors and artifacts of the workflow.

---

### Example 3: A Multi-Step Research Agent

**Problem:** A user asks a complex question like, "Summarize the impact of recent lithium shortages on the EV industry." An AI agent must break this down, perform web searches, query internal databases, synthesize the findings, and write a final report.

#### Step 1: Identify the Nouns
*   `ResearchRequest` (the top-level user query)
*   `ResearchStep` (a sub-task, like "search for news articles" or "query sales database")
*   `DataSource` (an entity representing a database or an API)
*   `Finding` (a piece of information discovered during a step)
*   `FinalReport`

#### Step 2: Identify the Verbs
*   A `ResearchRequest` **IsComposedOf** multiple `ResearchSteps`.
*   A `ResearchStep` **Queries** a `DataSource`.
*   A `ResearchStep` **Generates** one or more `Findings`.
*   A `FinalReport` **Synthesizes** the `Findings` from all steps.

#### Step 3: Identify the "Doers"
This is where the power of the graph becomes fully apparent.
*   `ResearchRequest`: This is the main orchestrator, a top-level **Runnable Entity**.
*   `ResearchStep`: Crucially, *each sub-task is also a **Runnable Entity***. This creates a hierarchy of work, allowing for complex, nested, and parallel execution.

#### Step 4: Sketch the Graph
The graph for this agent is **dynamic**. It is not predefined; it grows as the agent works.

*   Start with the user's `ResearchRequest`.
*   The `ResearchRequest` entity runs and creates several child `ResearchStep` entities, linked via `IsComposedOf` edges.
*   As each `ResearchStep` runs, it creates `Finding` entities, linking them with `Generates` edges. It might also link to a `DataSource` entity.
*   Once all steps are complete, the main `ResearchRequest` orchestrator can run a final step that traverses the graph it just built, gathers all the `Findings`, and creates the `FinalReport`.

The final graph is a complete, queryable "thought process" of the agent. You can see exactly which steps were taken, what was found at each step, and how those findings contributed to the final report. The graph becomes the agent's external memory and audit trail.

---

### Conclusion

You have now seen how to map three very different problems onto the FireFoundry Entity Graph. The four-step process—**Nouns, Verbs, Doers, Sketch**—is a powerful tool for designing your applications.

The key takeaway is to **whiteboard before you code**. A few minutes spent sketching your entities and their relationships will provide immense clarity and save hours of development and refactoring time.

**Next Step:** [Entity Modeling and Development (Technical Guide)](../core/entities.md)