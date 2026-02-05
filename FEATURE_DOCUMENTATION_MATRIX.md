# Agent SDK Feature Documentation Matrix

**Purpose**: Quick reference showing which features are documented and where
**Last Updated**: January 14, 2026
**Format**: Feature → Status → Location → Quality → Priority for Improvement

---

## Core Architecture (WELL DOCUMENTED)

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| Entities | ✅ | `/core/entities.md` | Comprehensive | No |
| Entity Graph Concepts | ✅ | `/entity_graph/README.md` | Excellent | No |
| Entity Modeling | ✅ | `/entity_graph/entity_modeling_tutorial.md` | Very Good | No |
| Bots | ✅ | `/core/bots.md` | Comprehensive | Minor |
| Prompts | ✅ | `/core/prompting.md` | Comprehensive | Minor |
| Prompt Groups | ✅ | `/core/prompting.md` | Good | Expand |
| Agent Bundles | ✅ | `/core/agent_bundles.md` | Very Good | No |
| @ApiEndpoint | ✅ | `/core/agent_bundles.md`, `/core/agent_bundle_tutorial.md` | Excellent | No |

---

## Entity System Features

### Decorators

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| @EntityDecorator | ✅ | `/core/entities.md` (lines 210-216) | Brief | Expand |
| @MetaClassDecorator | ✅ | `/core/entities.md` (lines 220-223) | Brief | Expand |
| @RunnableEntityDecorator | ✅ | `/core/entities.md` (lines 226-229) | Brief | Expand |
| @EntityDispatcherDecorator | ✅ | `/core/entities.md` (lines 232-237) | Brief | Expand |
| @registerBot | ❌ | None | N/A | Create |
| @registerPrompt | ❌ | None | N/A | Create |

### Entity Mixins

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| RunnableEntityMixin | ✅ | `/core/entities.md` (section 3.1) | Good | No |
| WaitableRunnableEntityMixin | ✅ | `/core/entities.md` (section 3.2), `/feature_guides/waitable_guide.md` | Excellent | No |
| BotRunnableEntityMixin | ✅ | `/core/entities.md` (section 3.3) | Good | Expand |
| EntityDispatcherMixin | ⚠️ | `/fire_foundry_core_concepts_glossary_agent_sdk.md`, `/core/entities.md` | Minimal | Expand |
| Custom Entity Mixins | ⚠️ | `/core/entities.md` (references) | Very Brief | Create Guide |

### Job Scheduling

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| CronJobManager | ✅ | `/core/entities.md` | Good | Minor |
| SchedulerNode | ✅ | `/core/entities.md` | Good | Minor |
| JobCallNode | ✅ | `/core/entities.md` | Good | Minor |
| WorkQueueNode | ✅ | `/core/entities.md` | Good | Minor |

### Entity Graph Features

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| Entity Edges (all types) | ✅ | `/core/entities.md` (section 1.2) | Comprehensive | No |
| EdgeMap / ArrayifyEdgeMap | ✅ | `/core/entities.md` (sections 2.1, 2.2) | Good | Minor |
| Graph Partitioning | ⚠️ | `/feature_guides/graph_traversal.md` | Minimal | Create Guide |
| Graph Traversal | ✅ | `/feature_guides/graph_traversal.md` | Good | No |

### Advanced Features

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| Waitable Entities | ✅ | `/core/entities.md` (section 3.2), `/feature_guides/waitable_guide.md` | Excellent | No |
| WorkflowOrchestration | ✅ | `/feature_guides/workflow_orchestration_guide.md` | Very Good | No |
| Entity Relationships | ✅ | `/core/entities.md`, `/entity_graph/intermediate_entity_graph_example.md` | Good | No |

---

## Bot System Features

### Bot Decorators & Base Classes

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| Bot (Base Class) | ✅ | `/core/bots.md` (section 1.1) | Good | No |
| BotRequest | ✅ | `/core/bots.md` (section 1.1) | Good | No |
| BotResponse | ✅ | `/core/bots.md` (section 1.1) | Good | No |

### Bot Mixins

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| BotMixin (Base) | ✅ | `/core/bots.md` (line 84) | Brief | Expand |
| StructuredOutputBotMixin | ✅ | `/core/bots.md` (line 80), tutorials | Good | No |
| WorkingMemoryBotMixin | ✅ | `/core/bots.md` (line 82) | Brief | Create Guide |
| FeedbackBotMixin | ⚠️ | `/core/bots.md` (line 83) | 1 line only | Create Guide |
| DataValidationBotMixin | ⚠️ | `/core/bots.md` (line 81) | Brief | Create Guide |
| Custom Bot Mixins | ⚠️ | `/core/bots.md` (line 84 reference) | Very Brief | Create Guide |
| FeedbackRunnableEntityMixin | ⚠️ | `/feature_guides/waitable_guide.md` | Minimal | Extract Guide |

### Bot Features

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| Tool Calls (Function Calling) | ✅ | `/feature_guides/ad_hoc_tool_calls.md` | Good | No |
| Error Handling | ✅ | `/core/bots.md`, tutorials | Good | No |
| Direct Execution | ✅ | `/core/bots.md` | Mentioned | No |

---

## Prompting System Features

### Prompt Types

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| Prompt (Base) | ✅ | `/core/prompting.md` | Good | No |
| PromptGroup | ✅ | `/core/prompting.md` (section 1.2) | Good | No |
| ConditionalPromptGroup | ✅ | `/core/prompting.md` (section 1.2) | Good | No |
| StructuredPromptGroup | ✅ | `/core/prompting.md` (section 1.2) | Brief | Expand |
| WMPromptGroup | ✅ | `/core/prompting.md` (section 1.2) | Brief | Expand |
| MemoryTidbitPrompt | ✅ | `/core/prompting.md` (section 1.2) | Brief | Expand |
| Data-Driven Prompts | ⚠️ | `/core/prompting.md`, `/core/prompting_tutorial.md` | Minimal | Create Guide |

### Template Nodes

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| PromptTemplateTextNode | ✅ | `/core/prompting.md` (section 1.2) | Good | No |
| PromptTemplateListNode | ✅ | `/core/prompting.md` (section 1.2) | Good | No |
| PromptTemplateCodeBoxNode | ✅ | `/core/prompting.md` (section 1.2) | Good | No |
| PromptTemplateSectionNode | ✅ | `/core/prompting.md` (section 1.2) | Good | No |
| PromptTemplateStructDataNode | ✅ | `/core/prompting.md` (section 1.2) | Good | No |
| PromptTemplateSchemaNode | ✅ | `/core/prompting.md` (section 1.2) | Good | No |
| PromptTemplateForEachNode | ✅ | `/core/prompting.md` (section 1.2) | Good | No |
| PromptTemplateIfElseNode | ✅ | `/core/prompting.md` (section 1.2) | Good | No |
| PromptTemplateSwitchNode | ✅ | `/core/prompting.md` (section 1.2) | Good | No |

### Cognitive Architecture

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| ContextProvider | ✅ | `/core/bots.md`, `/core/prompting.md` | Minimal | Create Reference |
| WorkingMemoryProvider | ✅ | `/feature_guides/file-upload-patterns.md` | Good | Expand |
| RAGProvider | ✅ | `/feature_guides/vector-similarity-quickstart.md` | Very Good | No |

---

## API Exposure & Server

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| FFAgentBundleServer | ⚠️ | `/core/agent_bundles.md` | Minimal | Create Guide |
| ExpressTransport | ❌ | None | N/A | Create |
| BotApiRequest | ⚠️ | Implied in docs | Very Brief | Create Reference |
| Binary Upload | ✅ | `/feature_guides/file-upload-patterns.md` | Excellent | No |
| Iterator Responses | ✅ | Multiple guides | Good | No |

---

## Data Validation System (CRITICAL GAPS)

### Core Decorators

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| @Copy | ❌ | None | N/A | Create |
| @DerivedFrom | ❌ | None | N/A | Create |
| @Set | ❌ | None | N/A | Create |
| @Merge | ❌ | None | N/A | Create |

### Coercion Decorators (9 total)

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| @Coerce | ❌ | None | N/A | Create |
| @CoerceType | ❌ | None | N/A | Create |
| @CoerceTrim | ❌ | None | N/A | Create |
| @CoerceCase | ❌ | None | N/A | Create |
| @CoerceFormat | ❌ | None | N/A | Create |
| @CoerceParse | ❌ | None | N/A | Create |
| @CoerceRound | ❌ | None | N/A | Create |
| @CoerceArrayElements | ❌ | None | N/A | Create |
| @CoerceFromSet | ❌ | None | N/A | Create |

### Validation Decorators (6 total)

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| @Validate | ❌ | None | N/A | Create |
| @ValidateRequired | ❌ | None | N/A | Create |
| @ValidateLength | ❌ | None | N/A | Create |
| @ValidatePattern | ❌ | None | N/A | Create |
| @ValidateRange | ❌ | None | N/A | Create |
| @CrossValidate | ❌ | None | N/A | Create |

### Conditional Decorators (4 total)

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| @If | ❌ | None | N/A | Create |
| @ElseIf | ❌ | None | N/A | Create |
| @Else | ❌ | None | N/A | Create |
| @EndIf | ❌ | None | N/A | Create |

### Context/Collection Decorators (10 total)

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| @Keys | ❌ | None | N/A | Create |
| @Values | ❌ | None | N/A | Create |
| @RecursiveKeys | ❌ | None | N/A | Create |
| @RecursiveValues | ❌ | None | N/A | Create |
| @Split | ❌ | None | N/A | Create |
| @Delimited | ❌ | None | N/A | Create |
| @Filter | ❌ | None | N/A | Create |
| @Map | ❌ | None | N/A | Create |
| @Join | ❌ | None | N/A | Create |
| @CollectProperties | ❌ | None | N/A | Create |

### Class/Schema Decorators (5 total)

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| @ValidatedClass | ❌ | None | N/A | Create |
| @ValidatedClassArray | ❌ | None | N/A | Create |
| @Discriminator | ❌ | None | N/A | Create |
| @DiscriminatedUnion | ❌ | None | N/A | Create |
| @ManageAll | ❌ | None | N/A | Create |

### Special Decorators (9 total)

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| @Staging | ❌ | None | N/A | Create |
| @Examples | ❌ | None | N/A | Create |
| @NormalizeText | ❌ | None | N/A | Create |
| @NormalizeTextChain | ❌ | None | N/A | Create |
| @MatchingStrategy | ❌ | None | N/A | Create |
| @UseStyle | ❌ | None | N/A | Create |
| @DefaultTransforms | ❌ | None | N/A | Create |
| @DependsOn | ❌ | None | N/A | Create |
| @ObjectRule | ❌ | None | N/A | Create |

### AI-Powered Decorators (12 total)

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| @AITransform | ❌ | None | N/A | Create |
| @AIValidate | ❌ | None | N/A | Create |
| @AITranslate | ❌ | None | N/A | Create |
| @AIRewrite | ❌ | None | N/A | Create |
| @AISummarize | ❌ | None | N/A | Create |
| @AIClassify | ❌ | None | N/A | Create |
| @AIExtract | ❌ | None | N/A | Create |
| @AISpellCheck | ❌ | None | N/A | Create |
| @AIJSONRepair | ❌ | None | N/A | Create |
| @Catch | ❌ | None | N/A | Create |
| @AICatchRepair | ❌ | None | N/A | Create |

### Text Normalizers (14 total)

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| EmailNormalizer | ❌ | None | N/A | Create |
| PhoneNormalizer | ❌ | None | N/A | Create |
| PhoneFormattedNormalizer | ❌ | None | N/A | Create |
| URLNormalizer | ❌ | None | N/A | Create |
| SlugNormalizer | ❌ | None | N/A | Create |
| UnicodeNormalizer | ❌ | None | N/A | Create |
| WhitespaceNormalizer | ❌ | None | N/A | Create |
| ControlCharNormalizer | ❌ | None | N/A | Create |
| HTMLEntityDecodeNormalizer | ❌ | None | N/A | Create |
| CreditCardNormalizer | ❌ | None | N/A | Create |
| SSNNormalizer | ❌ | None | N/A | Create |
| ZipCodeNormalizer | ❌ | None | N/A | Create |
| CurrencyNormalizer | ❌ | None | N/A | Create |

### Data Extraction (2 total)

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| @JSONPath | ❌ | None | N/A | Create |
| @ValidateJSONPath | ❌ | None | N/A | Create |

### Validation Integration

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| ValidationFactory | ⚠️ | `/README.md` (Zod mention) | 1 line | Create Guide |
| Zod Schema Support | ✅ | `/README.md`, `/fire_foundry_core_concepts_glossary_agent_sdk.md` | Good | No |

---

## Component System & Application Architecture

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| ComponentProvider | ❌ | None | N/A | Create |
| Applications | ⚠️ | Implied in structure | Very Brief | Create |
| Components | ⚠️ | Implied in structure | Very Brief | Create |
| Subcomponents | ⚠️ | Implied in structure | Very Brief | Create |
| Asset Loading | ❌ | None | N/A | Create |

---

## Database & Schema

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| Node Table Schema | ⚠️ | Implied in entity docs | Minimal | Create Reference |
| ConfigMeta Column | ❌ | None | N/A | Create |
| ContextMeta Column | ❌ | None | N/A | Create |

---

## Review & Feedback Workflows

| Feature | Status | Location | Quality | Needs Update |
|---------|--------|----------|---------|--------------|
| ReviewableEntity | ❌ | None | N/A | Create |
| ReviewStep | ❌ | None | N/A | Create |
| Review Workflows | ❌ | None | N/A | Create Guide |

---

## Feature Guides Summary

| Guide Name | Status | Quality | Needs Update |
|------------|--------|---------|--------------|
| Tool Calls | ✅ | Good | No |
| File Upload Patterns | ✅ | Excellent | No |
| Graph Traversal | ✅ | Good | No |
| Vector Similarity | ✅ | Very Good | No |
| Waitable Entities | ✅ | Excellent | No |
| Workflow Orchestration | ✅ | Very Good | No |
| Advanced Parallelism | ✅ | Good | No |
| Document Processing Client | ✅ | Good | No |

---

## Summary Statistics

### By Status
- **✅ Fully Documented**: 19 features (27%)
- **⚠️ Partially Documented**: 21 features (30%)
- **❌ Not Documented**: 30+ features (43%)

### By Category
- **Core Architecture**: 95% covered ✅
- **Entity System**: 75% covered ⚠️
- **Bot System**: 60% covered ⚠️
- **Prompting**: 75% covered ⚠️
- **Data Validation**: 0% covered ❌ (50+ items)
- **Component System**: 0% covered ❌
- **Server/API**: 50% covered ⚠️

### Priority for Improvement
1. **CRITICAL** (0% coverage): Data validation (50+ items)
2. **HIGH** (0% coverage): Review workflows, Component system, Core decorators
3. **MEDIUM** (50-75% coverage): Advanced prompting, Advanced bot mixins, Job scheduling
4. **LOW** (75%+ coverage): Core architecture - maintain existing

---

## Recommended Creation Priority

**HIGHEST**: Data Validation Library (50+ decorators)
- **Impact**: HIGH
- **Effort**: 15-20 hours
- **Dependencies**: None

**HIGH**: Advanced Features
- @registerBot/@registerPrompt guides (4 hours)
- Advanced bot mixins guide (4 hours)
- Review workflow guide (4 hours)

**MEDIUM**: Reference Material
- Text normalizers reference (3 hours)
- Component system guide (4 hours)
- Database schema reference (3 hours)

**LOW**: Nice-to-have
- Graph partitioning guide (3 hours)
- Custom mixin development (4 hours)
- Advanced configuration (3 hours)

---

## How to Use This Matrix

1. **For Documentation Stakeholders**: See coverage by category and priority
2. **For Feature Developers**: Find which features are documented
3. **For Support Team**: Identify undocumented features that generate questions
4. **For Writers**: Use as task list for documentation sprints
5. **For Product Managers**: Identify gaps blocking adoption

