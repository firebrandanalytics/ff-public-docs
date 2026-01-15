# Agent SDK Documentation - Implementation Roadmap

**Created**: January 14, 2026
**Priority**: Based on impact to developer productivity and completeness

---

## Quick Stats

- **Total Features Inventoried**: 70+ items
- **Currently Documented**: 19 (27%)
- **Partially Documented**: 21 (30%)
- **Not Documented**: 30+ (43%)
- **Critical Gaps**: 8 feature areas
- **Estimated Hours to Complete**: 40-60 hours

---

## Phase 1: Critical Gaps (Weeks 1-2)

### 1.1 Data Validation Library Overview
**Status**: ❌ Missing
**Impact**: HIGH - 50+ decorators completely undocumented
**Deliverable**: `feature_guides/data-validation-overview.md`

**Content**:
- Why data validation matters in Agent SDK
- Architectural overview of validation system
- When to use each category of decorators
- Integration with bots and entities
- Performance considerations

**Time Estimate**: 3-4 hours
**Dependencies**: None

---

### 1.2 Core Decorators Reference
**Status**: ❌ Missing
**Impact**: HIGH - Fundamental registration patterns
**Deliverable**: `core/decorators-reference.md`

**Content**:
- @registerBot - Registration and reusability patterns
- @registerPrompt - Prompt registration and composition
- @EntityDecorator - Entity definition patterns
- @MetaClassDecorator - Meta-entity patterns (expanded)
- @RunnableEntityDecorator - Runnable entity creation (expanded)
- @EntityDispatcherDecorator - Dispatcher patterns (expanded)
- Best practices and common patterns

**Examples Needed**:
- Bot registration and usage
- Prompt registration with composition
- Entity type hierarchy
- Dispatcher usage for multi-step workflows

**Time Estimate**: 4-5 hours
**Dependencies**: None

---

### 1.3 Data Coercion Patterns Guide
**Status**: ❌ Missing
**Impact**: HIGH - Common data cleaning operations
**Deliverable**: `feature_guides/data-coercion-patterns.md`

**Content**:
- Overview of 9 coercion decorators
- When to use coercion vs. validation
- Common patterns:
  - Type coercion (CoerceType)
  - Text cleaning (CoerceTrim, CoerceCase)
  - Format conversion (CoerceFormat, CoerceParse)
  - Mathematical operations (CoerceRound)
  - Collections (CoerceArrayElements)

**Decorators to Cover** (9 total):
1. @Coerce - Generic coercion
2. @CoerceType - Type conversion
3. @CoerceTrim - Whitespace removal
4. @CoerceCase - Case conversion
5. @CoerceFormat - Format application
6. @CoerceParse - Parsing (e.g., JSON strings)
7. @CoerceRound - Numeric rounding
8. @CoerceArrayElements - Array element transformation
9. @CoerceFromSet - Value mapping

**Time Estimate**: 3-4 hours
**Dependencies**: 1.1 (overview context)

---

### 1.4 Data Validation Patterns Guide
**Status**: ❌ Missing
**Impact**: HIGH - Core validation mechanics
**Deliverable**: `feature_guides/data-validation-patterns.md`

**Content**:
- Overview of 6 validation decorators
- Validation strategies and composition
- Error handling and messaging
- Custom validation logic
- Integration with bot output validation

**Decorators to Cover** (6 total):
1. @Validate - Generic validation
2. @ValidateRequired - Required fields
3. @ValidateLength - String/array length
4. @ValidatePattern - Regex validation
5. @ValidateRange - Numeric ranges
6. @CrossValidate - Multi-field validation

**Time Estimate**: 3-4 hours
**Dependencies**: 1.1 (overview context)

---

### 1.5 Advanced Bot Mixins Guide
**Status**: ⚠️ Partially documented
**Impact**: HIGH - Advanced bot capabilities
**Deliverable**: Expand `/core/bots.md` sections 1.2-1.3 + new guide

**Content**:
- **Existing** (expand):
  - StructuredOutputBotMixin (add more complex examples)
  - DataValidationBotMixin (currently only 1 line)
  - WorkingMemoryBotMixin (expand with examples)
  - FeedbackBotMixin (expand with use cases)
  - FeedbackRunnableEntityMixin (cross-reference to entity guide)

- **New Examples**:
  - Composing multiple mixins
  - Custom mixin creation (BotMixin base class)
  - Error handling with mixins
  - Testing mixin-based bots

**Time Estimate**: 4-5 hours
**Dependencies**: 1.1

---

## Phase 2: Major Feature Gaps (Weeks 3-4)

### 2.1 Text Normalization Reference
**Status**: ❌ Missing
**Impact**: MEDIUM - Domain-specific text cleaning
**Deliverable**: `feature_guides/text-normalization-reference.md`

**Content**:
- Overview of 14 text normalizer types
- When to use each normalizer
- Chaining normalizers
- Performance on large datasets

**Normalizers to Document** (14 total):
1. EmailNormalizer
2. PhoneNormalizer
3. PhoneFormattedNormalizer
4. URLNormalizer
5. SlugNormalizer
6. UnicodeNormalizer
7. WhitespaceNormalizer
8. ControlCharNormalizer
9. HTMLEntityDecodeNormalizer
10. CreditCardNormalizer (with security notes)
11. SSNNormalizer (with security notes)
12. ZipCodeNormalizer
13. CurrencyNormalizer
14. (Any others in library)

**Time Estimate**: 3-4 hours
**Dependencies**: 1.1

---

### 2.2 AI-Powered Data Processing Guide
**Status**: ❌ Missing
**Impact**: MEDIUM-HIGH - Advanced data transformation
**Deliverable**: `feature_guides/ai-powered-data-processing.md`

**Content**:
- Overview of 12 AI decorators
- When to use AI-powered vs. rule-based validation
- Cost and performance considerations
- Error handling and fallbacks
- Chain-of-thought validation patterns

**Decorators to Cover** (12 total):
1. @AITransform - Generic AI transformation
2. @AIValidate - AI-powered validation
3. @AITranslate - Language translation
4. @AIRewrite - Content rewriting
5. @AISummarize - Text summarization
6. @AIClassify - Classification/categorization
7. @AIExtract - Information extraction
8. @AISpellCheck - Spelling correction
9. @AIJSONRepair - Malformed JSON repair
10. @Catch - Error catching decorator
11. @AICatchRepair - AI-powered error repair

**Time Estimate**: 4-5 hours
**Dependencies**: 1.1, 1.4

---

### 2.3 Advanced Prompting Patterns
**Status**: ⚠️ Partially documented
**Impact**: MEDIUM - Advanced prompt composition
**Deliverable**: Expand `/core/prompting.md` + new feature guide

**Content in main prompting.md**:
- Expand StructuredPromptGroup section
- Expand WMPromptGroup section with working memory integration
- Data-driven prompts with real examples
- MemoryTidbitPrompt with context persistence

**New Feature Guide** (`feature_guides/advanced-prompting-patterns.md`):
- When to use each prompt group type
- Composing prompt groups
- Conditional prompting strategies
- Working memory integration patterns
- Performance optimization

**Time Estimate**: 4-5 hours
**Dependencies**: None (enhances existing)

---

### 2.4 Review and Feedback Workflows
**Status**: ❌ Missing
**Impact**: MEDIUM - Enterprise workflow pattern
**Deliverable**: `feature_guides/review-and-feedback-workflows.md`

**Content**:
- ReviewableEntity patterns
- ReviewStep architecture
- FeedbackRunnableEntityMixin integration
- Multi-stage approval workflows
- Integration with waitable entities
- Audit trail and tracking

**Examples**:
- Document review workflow
- Multi-reviewer approval process
- Feedback collection and iteration
- Status tracking and notifications

**Time Estimate**: 4-5 hours
**Dependencies**: Waitable entities guide (existing)

---

### 2.5 Conditional Transformation Logic
**Status**: ❌ Missing
**Impact**: MEDIUM - Advanced data transformation
**Deliverable**: `feature_guides/conditional-transformation-logic.md`

**Content**:
- Overview of 4 conditional decorators
- Building complex transformation pipelines
- Nested conditionals and edge cases
- Performance with large datasets

**Decorators to Cover** (4 total):
1. @If - Conditional transformation start
2. @ElseIf - Alternative conditions
3. @Else - Default condition
4. @EndIf - Condition block end

**Time Estimate**: 2-3 hours
**Dependencies**: 1.1

---

## Phase 3: Support Documentation (Weeks 5-6)

### 3.1 Data Extraction Patterns
**Status**: ❌ Missing
**Impact**: MEDIUM - JSONPath and context extraction
**Deliverable**: `feature_guides/data-extraction-patterns.md`

**Content**:
- JSONPath decorator for property extraction
- ValidateJSONPath for validation extraction
- Context decorators (Keys, Values, RecursiveKeys, RecursiveValues)
- String splitting (Split, Delimited)
- Collection operations (Filter, Map, Join, CollectProperties)

**Decorators to Cover** (12 total):
1. @JSONPath - Property extraction
2. @ValidateJSONPath - Extraction validation
3. @Keys - Object key extraction
4. @Values - Object value extraction
5. @RecursiveKeys - Recursive key extraction
6. @RecursiveValues - Recursive value extraction
7. @Split - String splitting
8. @Delimited - Delimited parsing
9. @Filter - Array filtering
10. @Map - Array mapping
11. @Join - Array joining
12. @CollectProperties - Property collection

**Time Estimate**: 3-4 hours
**Dependencies**: 1.1

---

### 3.2 Schema Definition Patterns
**Status**: ❌ Missing
**Impact**: MEDIUM - Object schema definition
**Deliverable**: `feature_guides/schema-definition-patterns.md`

**Content**:
- Class decorators for schema definition
- Discriminated unions for polymorphism
- Managed collection patterns
- Schema composition and inheritance
- Type safety patterns

**Decorators to Cover** (5 total):
1. @ValidatedClass - Single class validation
2. @ValidatedClassArray - Array of classes
3. @Discriminator - Discriminator field specification
4. @DiscriminatedUnion - Union type definition
5. @ManageAll - Comprehensive management

**Time Estimate**: 3-4 hours
**Dependencies**: 1.1

---

### 3.3 Advanced Configuration Patterns
**Status**: ❌ Missing
**Impact**: LOW-MEDIUM - Specialized configuration
**Deliverable**: `feature_guides/advanced-configuration-patterns.md`

**Content**:
- Staging data for processing
- Example-driven documentation
- Text normalization chains
- Strategy patterns for data handling
- Style enforcement
- Default transformation chains
- Dependency management
- Object-level rules

**Decorators to Cover** (9 total):
1. @Staging - Staging data for processing
2. @Examples - Example documentation
3. @NormalizeText - Single pass normalization
4. @NormalizeTextChain - Multi-pass normalization
5. @MatchingStrategy - Matching strategy specification
6. @UseStyle - Style enforcement
7. @DefaultTransforms - Default transformations
8. @DependsOn - Dependency specification
9. @ObjectRule - Object-level validation rules

**Time Estimate**: 3-4 hours
**Dependencies**: 1.1

---

### 3.4 Custom Mixin Development
**Status**: ⚠️ Partially documented
**Impact**: MEDIUM - Advanced extensibility
**Deliverable**: `feature_guides/custom-mixin-development.md`

**Content**:
- EntityMixin base class structure
- BotMixin base class structure
- Creating custom entity mixins
- Creating custom bot mixins
- Mixin composition patterns
- Testing custom mixins
- Performance considerations
- Best practices

**Examples**:
- Custom validation mixin
- Custom logging mixin
- Custom caching mixin

**Time Estimate**: 4-5 hours
**Dependencies**: 1.5, entity/bot core guides

---

## Phase 4: Reference Documentation (Weeks 7-8)

### 4.1 Database Schema Reference
**Status**: ❌ Missing
**Impact**: MEDIUM - Schema design patterns
**Deliverable**: `core/database-schema-reference.md`

**Content**:
- Node table schema overview
- ConfigMeta column for configuration storage
- ContextMeta column for runtime context
- Edge table relationships
- Indexing strategies
- Query patterns
- Schema migrations

**Time Estimate**: 3-4 hours
**Dependencies**: Entity guide

---

### 4.2 Graph Partitioning Guide
**Status**: ⚠️ Partially documented
**Impact**: LOW-MEDIUM - Advanced graph patterns
**Deliverable**: `feature_guides/graph-partitioning-guide.md`

**Content**:
- EdgeMap and ArrayifyEdgeMap type system
- Partitioning strategies
- Query performance optimization
- Multi-graph scenarios
- Subgraph isolation
- Cross-partition relationships

**Time Estimate**: 3-4 hours
**Dependencies**: Entity graph guide

---

### 4.3 Component System Guide
**Status**: ❌ Missing
**Impact**: MEDIUM - Application structure
**Deliverable**: `core/component-system-guide.md`

**Content**:
- ComponentProvider architecture
- Applications structure
- Components definition
- Subcomponents nesting
- Asset loading and management
- Component lifecycle
- Composition patterns

**Time Estimate**: 4-5 hours
**Dependencies**: Bundle guide

---

### 4.4 Advanced Job Scheduling Patterns
**Status**: ⚠️ Partially documented
**Impact**: MEDIUM - Background processing
**Deliverable**: Expand existing or create `feature_guides/job-scheduling-patterns.md`

**Content to Add**:
- CronJobManager deployment patterns
- SchedulerNode scaling strategies
- JobCallNode error handling and retries
- WorkQueueNode throughput optimization
- Monitoring and observability
- Resource management
- Task prioritization

**Time Estimate**: 3-4 hours
**Dependencies**: Entities guide (existing content)

---

## Implementation Guidelines

### Writing Standards
1. **Tone**: Professional, practical, example-driven
2. **Structure**: Problem → Solution → Code → Best Practices
3. **Code Examples**: Always working, tested, self-contained
4. **Diagrams**: Use Mermaid for architecture; ASCII for simple flows
5. **Length**: 3,000-5,000 words for comprehensive guides
6. **Target Audience**: Mid-level TypeScript developers

### Documentation Template
```markdown
# [Feature] Guide

## Overview
- What is [feature]?
- When to use it
- Key benefits

## Core Concepts
- Architecture
- Key components
- Design patterns

## Getting Started
- Simple example
- Step-by-step walkthrough

## Advanced Patterns
- Complex scenarios
- Best practices
- Performance tips

## Common Pitfalls
- What to avoid
- Debugging tips

## API Reference
- Key interfaces/types
- Configuration options

## Examples
- Real-world use cases
- Complete code samples

## See Also
- Related features
- Further reading
```

### Review Checklist
- [ ] Code examples compile/run successfully
- [ ] All API references are accurate
- [ ] Links to related docs are correct
- [ ] Examples follow established patterns
- [ ] Tone is consistent with existing docs
- [ ] No duplicated content
- [ ] Search keywords included in metadata
- [ ] Proofreading complete

---

## Success Metrics

### Coverage Metrics
- **Target**: 100% of documented features
- **Current**: 27% (19/70 items)
- **After Phase 1**: 45% (added 13 items)
- **After Phase 2**: 68% (added 8 items)
- **After Phase 3**: 85% (added 12 items)
- **After Phase 4**: 100% (added 8 items)

### Quality Metrics
- **Code Example Coverage**: 100% (all guides have working examples)
- **Cross-Reference Accuracy**: 100% (all links validated)
- **User Satisfaction**: Track via feedback/questions

### Timeline Metrics
- **Phase 1**: 2 weeks (20-22 hours)
- **Phase 2**: 2 weeks (21-24 hours)
- **Phase 3**: 2 weeks (20-23 hours)
- **Phase 4**: 2 weeks (13-17 hours)
- **Total**: 8 weeks, 74-86 hours

---

## Priority Matrix

### MUST HAVE (Complete ASAP)
1. Data validation overview (1.1)
2. Data coercion patterns (1.3)
3. Data validation patterns (1.4)
4. Core decorators reference (1.2)
5. Advanced bot mixins (1.5)

### SHOULD HAVE (Complete within 8 weeks)
1. Text normalization reference (2.1)
2. AI-powered data processing (2.2)
3. Advanced prompting patterns (2.3)
4. Review/feedback workflows (2.4)
5. Data extraction patterns (3.1)

### NICE TO HAVE (Complete by month 3)
1. Conditional transformation logic (2.5)
2. Schema definition patterns (3.2)
3. Advanced configuration (3.3)
4. Custom mixin development (3.4)
5. Database schema reference (4.1)
6. Graph partitioning guide (4.2)
7. Component system guide (4.3)
8. Advanced job scheduling (4.4)

---

## Resource Requirements

### Writing
- Primary writer: 40-60 hours
- Technical review: 20-30 hours
- Editing/proofreading: 10-15 hours
- **Total**: 70-105 hours (10-13 weeks for 1 person)

### Code Examples
- Development: 20-30 hours (building example projects)
- Testing: 10-15 hours
- Integration: 5-10 hours
- **Total**: 35-55 hours

### Process
- Setup/planning: 5 hours
- Coordination: 5-10 hours
- **Total**: 10-15 hours

**Grand Total**: 115-175 hours (2-3 months for 1 person, 4-6 weeks for 2-3 people)

---

## Next Steps

1. **Immediate** (This week):
   - Approve roadmap and timeline
   - Assign writer(s)
   - Create documentation templates
   - Set up review process

2. **Week 1-2** (Phase 1):
   - Write 5 critical guides
   - Get technical review
   - Publish to staging

3. **Weeks 3-8**:
   - Follow phase schedule
   - Regular reviews and updates
   - Gather user feedback
   - Iterate on examples

4. **Ongoing**:
   - Monitor for new features
   - Update related documentation
   - Track usage and adjust

---

## Success Criteria

The documentation roadmap is considered successful when:

1. ✅ All 70+ identified features have documentation
2. ✅ Each major feature has working code examples
3. ✅ Documentation passes technical review
4. ✅ Cross-references between guides are accurate
5. ✅ Search/discoverability works well
6. ✅ User feedback indicates clarity and completeness
7. ✅ Metrics show increased feature adoption post-documentation

