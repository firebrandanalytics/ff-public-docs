# Designing Entity Graphs: Job-Resume Matching

## Introduction to Entity Graph Design

Entity graphs in FireFoundry represent your business domain as connected objects that can maintain state, relationships, and behavior. Good entity design starts with understanding your domain and identifying the natural objects and their interactions.

In this tutorial, we'll design an entity graph for **job description to resume matching**, walking through the design process and then implementing it with the Agent Bundle SDK.

## Problem Analysis and Entity Identification

### Starting with the Business Problem

**Domain**: HR and recruiting
**Core Task**: Analyze how well a candidate's resume matches a specific job description
**Output**: Matching score with detailed explanation

Let's think through what objects exist in this domain:

1. **Job Descriptions**: Contain requirements, responsibilities, qualifications
2. **Resumes**: Contain candidate skills, experience, education
3. **The Matching Process**: The analysis that compares JD to resume

### Natural Entity Candidates

From this analysis, we can identify three natural entities:

**JobDescription Entity**
- **Purpose**: Store job posting content and metadata
- **Data**: JD text, title, company, requirements
- **Behavior**: Mostly passive data storage

**Resume Entity** 
- **Purpose**: Store candidate resume content and metadata
- **Data**: Resume text, candidate name, contact info
- **Behavior**: Mostly passive data storage

**MatchingScore Entity**
- **Purpose**: Represent the matching computation and store results
- **Data**: Score, explanation, metadata about the match
- **Behavior**: Active - performs the AI-powered matching analysis

### Why This Entity Structure Works

1. **Single Responsibility**: Each entity has a clear, focused purpose
2. **Reusability**: JDs and Resumes can be matched against multiple counterparts
3. **Computational Representation**: MatchingScore represents both the process and the result
4. **Auditability**: Each match is a persistent entity with full context
5. **Extensibility**: Easy to add more entity types later (Company, Candidate, etc.)

## Relationship Design

### Entity Relationships

Our entities connect through these relationships:

```
JobDescription ←--[Evaluates]--→ MatchingScore ←--[Evaluates]--→ Resume
                                      ↓
                               [Contains] Score + Explanation
```

**Relationship Types**:
- **Evaluates**: MatchingScore evaluates both a JobDescription and a Resume
- **Many-to-Many**: Each JD can have multiple matches, each Resume can have multiple matches
- **Computational Edge**: MatchingScore represents the computation connecting JD and Resume

### Graph Traversal Patterns

With this design, we can easily query:
- All matches for a specific job description
- All matches for a specific resume  
- Best matches across the entire dataset
- Detailed analysis for any specific match

## Entity Implementation

### JobDescription Entity

```typescript
import {
  EntityNode,
  EntityNodeTypeHelper,
  EntityFactory,
  EntityDecorator
} from '@firebrandanalytics/ff-agent-sdk';
import {
  type UUID,
  type EntityInstanceNodeDTO,
  type JSONValue
} from '@firebrandanalytics/shared-types';

// Define DTO structure
export interface JobDescriptionDTOData {
  title: string;
  company: string;
  description_text: string;
  requirements?: string;
  location?: string;
  salary_range?: string;
  posted_date?: string;
  [key: string]: JSONValue;
}

export type JobDescriptionDTO = EntityInstanceNodeDTO<JobDescriptionDTOData> & {
  node_type: "JobDescription";
};

@EntityDecorator({
  specificType: 'JobDescription',
  generalType: 'JobDescription',
  allowedConnections: {
    'Evaluates': ['MatchingScore'] // JD can be evaluated by multiple matches
  }
})
export class JobDescription extends EntityNode<
  EntityNodeTypeHelper<any, JobDescriptionDTO, 'JobDescription', 
    { 'Evaluates': ['MatchingScore'] }, {}>
> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | JobDescriptionDTO) {
    super(factory, idOrDto);
  }

  // Helper methods for working with job descriptions
  async get_title(): Promise<string> {
    const dto = await this.get_dto();
    return dto.data.title;
  }

  async get_description_text(): Promise<string> {
    const dto = await this.get_dto();
    return dto.data.description_text;
  }

  async update_description(newText: string): Promise<void> {
    await this.update_data({
      ...(this._dto?.data || {}),
      description_text: newText
    });
  }

  // Get all matching scores for this JD
  async get_all_matches(): Promise<any[]> {
    await this.load();
    const evaluates_edges = (this.edges_from as any)['Evaluates'] || [];
    return Promise.all(
      evaluates_edges.map((edge: any) => edge.get_to())
    );
  }
}
```

### Resume Entity

```typescript
// Define DTO structure  
export interface ResumeDTOData {
  candidate_name: string;
  resume_text: string;
  email?: string;
  phone?: string;
  years_experience?: number;
  skills?: string[];
  education?: string;
  [key: string]: JSONValue;
}

export type ResumeDTO = EntityInstanceNodeDTO<ResumeDTOData> & {
  node_type: "Resume";
};

@EntityDecorator({
  specificType: 'Resume',
  generalType: 'Resume', 
  allowedConnections: {
    'Evaluates': ['MatchingScore'] // Resume can be evaluated by multiple matches
  }
})
export class Resume extends EntityNode<
  EntityNodeTypeHelper<any, ResumeDTO, 'Resume',
    { 'Evaluates': ['MatchingScore'] }, {}>
> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | ResumeDTO) {
    super(factory, idOrDto);
  }

  // Helper methods for working with resumes
  async get_candidate_name(): Promise<string> {
    const dto = await this.get_dto();
    return dto.data.candidate_name;
  }

  async get_resume_text(): Promise<string> {
    const dto = await this.get_dto();
    return dto.data.resume_text;
  }

  async update_resume(newText: string): Promise<void> {
    await this.update_data({
      ...(this._dto?.data || {}),
      resume_text: newText
    });
  }

  // Get all matching scores for this resume
  async get_all_matches(): Promise<any[]> {
    await this.load();
    const evaluates_edges = (this.edges_from as any)['Evaluates'] || [];
    return Promise.all(
      evaluates_edges.map((edge: any) => edge.get_to())
    );
  }
}
```

### MatchingScore Entity (Runnable)

This is the most interesting entity - it represents the computational process of matching:

```typescript
import {
  AddMixins,
  BotRequestArgs,
  EntityNode,
  EntityNodeTypeHelper,
  EntityFactory,
  RunnableEntityDecorator,
  RunnableEntityMixin,
  BotRunnableEntityMixin,
  RunnableEntityTypeHelper,
  UUID
} from '@firebrandanalytics/ff-agent-sdk/entity';
import { MatchingBot } from '../bots/MatchingBot.js';
import { JSONValue, EntityInstanceNodeDTO } from '@firebrandanalytics/shared-types';

// Define DTO structure
export interface MatchingScoreDTOData {
  job_description_id: string;
  resume_id: string;
  match_score?: number;        // 0-100 score
  explanation?: string;        // Detailed analysis
  key_strengths?: string[];    // Areas of strong match
  key_gaps?: string[];         // Areas where candidate falls short
  created_at?: string;
  [key: string]: JSONValue;
}

export type MatchingScoreDTO = EntityInstanceNodeDTO<MatchingScoreDTOData> & {
  node_type: "MatchingScore";
};

// Define the runnable entity type helper
type MATCHING_RETH = RunnableEntityTypeHelper<
  EntityNodeTypeHelper<
    any,
    MatchingScoreDTO,
    "MatchingScore",
    {}, // edges_from
    { 'Evaluates': ['JobDescription', 'Resume'] } // edges_to
  >,
  MatchingResult,
  {}
>;

// Use mixin composition: EntityNode + RunnableEntityMixin + BotRunnableEntityMixin
@RunnableEntityDecorator(
  {
    generalType: "MatchingScore",
    specificType: "MatchingScore",
    allowedConnections: {
      'Evaluates': ['JobDescription', 'Resume'] // This entity evaluates both JD and Resume
    }
  }
)
export class MatchingScore
  extends AddMixins(
    EntityNode,
    RunnableEntityMixin,
    BotRunnableEntityMixin
  )
{
  constructor(factory: EntityFactory<any>, idOrDto: UUID | MatchingScoreDTO) {
    super(factory, idOrDto);
  }

  // Connect entity data to bot input
  protected async get_bot_request_args(): Promise<BotRequestArgs<MATCHING_BTH>> {
    const dto = await this.get_dto();
    
    // Get the connected JobDescription and Resume
    const jobDescription = await this.get_job_description();
    const resume = await this.get_resume();
    
    const jobDto = await jobDescription.get_dto();
    const resumeDto = await resume.get_dto();

    return {
      id: "matching_analysis_request",
      args: {
        job_title: jobDto.data.title,
        company: jobDto.data.company
      },
      input: {
        job_description: jobDto.data.description_text,
        resume: resumeDto.data.resume_text,
        candidate_name: resumeDto.data.candidate_name
      },
      context: new Context(dto),
      parent: undefined
    };
  }

  // Helper methods to traverse the entity graph
  async get_job_description(): Promise<JobDescription> {
    await this.load();
    const evaluates_edges = (this.edges_to as any)['Evaluates'] || [];
    const jd_edge = evaluates_edges.find((edge: any) => 
      edge.from_node_type === 'JobDescription'
    );
    if (!jd_edge) {
      throw new Error('No JobDescription connected to this MatchingScore');
    }
    return await jd_edge.get_from();
  }

  async get_resume(): Promise<Resume> {
    await this.load();
    const evaluates_edges = (this.edges_to as any)['Evaluates'] || [];
    const resume_edge = evaluates_edges.find((edge: any) => 
      edge.from_node_type === 'Resume'
    );
    if (!resume_edge) {
      throw new Error('No Resume connected to this MatchingScore');
    }
    return await resume_edge.get_from();
  }

  // Convenience method to get both connected entities
  async get_match_context(): Promise<{
    jobDescription: JobDescription;
    resume: Resume;
  }> {
    return {
      jobDescription: await this.get_job_description(),
      resume: await this.get_resume()
    };
  }
}
```

## Creating the Matching Bot and Prompt

### Define the Output Schema

```typescript
import { z } from 'zod';
import { withSchemaMetadata } from '@firebrandanalytics/ff-agent-sdk';

const MatchingResultSchema = withSchemaMetadata(
  z.object({
    overall_score: z.number().min(0).max(100)
      .describe('Overall matching score from 0-100'),
    explanation: z.string()
      .describe('Detailed explanation of the matching analysis'),
    key_strengths: z.array(z.string())
      .describe('Areas where the candidate strongly matches the job requirements'),
    key_gaps: z.array(z.string()) 
      .describe('Areas where the candidate falls short of job requirements'),
    recommendation: z.enum(['strong_match', 'good_match', 'weak_match', 'poor_match'])
      .describe('Overall hiring recommendation based on the match'),
    confidence: z.number().min(0).max(1)
      .describe('Confidence in this assessment (0-1)')
  }),
  'MatchingResult',
  'Job-to-resume matching analysis with score and detailed breakdown'
);

type MatchingResult = z.infer<typeof MatchingResultSchema>;
```

### Matching Bot Implementation

```typescript
import {
  ComposeMixins,
  MixinBot,
  BotTypeHelper,
  PromptTypeHelper,
  BotTryRequest,
  PromptGroup
} from '@firebrandanalytics/ff-agent-sdk/bot';
import { StructuredOutputBotMixin } from '@firebrandanalytics/ff-agent-sdk/bot';
import { MatchingPrompt } from '../prompts/MatchingPrompt.js';
import { z } from 'zod';

// Define types for the matching input
type MATCHING_PROMPT_INPUT = {
  job_description: string;
  resume: string;
  candidate_name: string;
};

type MATCHING_PROMPT_ARGS = {
  static: {
    job_title?: string;
    company?: string;
  };
  request: {};
};

type MATCHING_PTH = PromptTypeHelper<MATCHING_PROMPT_INPUT, MATCHING_PROMPT_ARGS>;
type MATCHING_BTH = BotTypeHelper<MATCHING_PTH, MatchingResult>;

// Define the matching result schema with Zod
export const MatchingResultSchema = z.object({
  match_score: z.number().min(0).max(100),
  explanation: z.string(),
  key_strengths: z.array(z.string()),
  key_gaps: z.array(z.string())
});

export type MatchingResult = z.infer<typeof MatchingResultSchema>;

// Use mixin composition: MixinBot + StructuredOutputBotMixin
export class MatchingBot extends ComposeMixins(
  MixinBot,
  StructuredOutputBotMixin
) {
  constructor() {
    const prompt_group = new PromptGroup<MATCHING_PTH>([
      {
        name: "matching_prompt",
        prompt: new MatchingPrompt({ company: "Recruiting Corp" })
      },
    ]);

    super({
      name: "MatchingBot",
      schema: MatchingResultSchema,
      schema_description: "Analyzes job-to-resume fit with scoring and detailed breakdown",
      base_prompt_group: prompt_group,
      model_pool_name: "firebrand_completion_default"
    });
  }

  override get_semantic_label_impl(_request: BotTryRequest<MATCHING_BTH>): string {
    return "MatchingBotSemanticLabel";
  }
}
```

### Matching Prompt Implementation

```typescript
import {
  Prompt,
  PromptTemplateNode,
  PromptTemplateSectionNode,
  PromptTemplateListNode,
  PromptTemplateSchemaSetNode,
  PromptTemplateCodeBoxNode
} from '@firebrandanalytics/ff-agent-sdk';

export class MatchingPrompt extends Prompt<MATCHING_PTH> {
  constructor(args: MATCHING_PTH['args']['static']) {
    super('system', args);
    this.add_section(this.get_Context_Section());
    this.add_section(this.get_Analysis_Framework());
    this.add_section(this.get_Scoring_Guidelines());
    this.add_section(this.get_Schema_Section());
  }

  get_Context_Section(): PromptTemplateNode<MATCHING_PTH> {
    return new PromptTemplateSectionNode<MATCHING_PTH>({
      semantic_type: 'context',
      content: 'Context:',
      children: [
        `You are an expert HR analyst and recruiter for ${this.static_args.company || 'a leading company'}.`,
        `Your task is to analyze how well a candidate's resume matches a specific job description.`,
        `Provide objective, detailed analysis with actionable insights for hiring decisions.`
      ]
    });
  }

  get_Analysis_Framework(): PromptTemplateNode<MATCHING_PTH> {
    return new PromptTemplateSectionNode<MATCHING_PTH>({
      semantic_type: 'rule',
      content: 'Analysis Framework:',
      children: [
        new PromptTemplateListNode<MATCHING_PTH>({
          semantic_type: 'rule',
          children: [
            `**Skills Match**: Compare technical and soft skills against requirements`,
            `**Experience Level**: Evaluate years of experience and seniority level`,
            `**Industry Relevance**: Assess experience in relevant industries or domains`,
            `**Education Fit**: Compare educational background to job requirements`,
            `**Cultural Indicators**: Look for values, work style, and cultural fit signals`,
            `**Growth Potential**: Consider candidate's trajectory and potential for growth`
          ],
          list_label_function: () => '• '
        })
      ]
    });
  }

  get_Scoring_Guidelines(): PromptTemplateNode<MATCHING_PTH> {
    return new PromptTemplateSectionNode<MATCHING_PTH>({
      semantic_type: 'rule',
      content: 'Scoring Guidelines:',
      children: [
        new PromptTemplateCodeBoxNode<MATCHING_PTH>({
          content: 'Score Ranges:',
          children: [
            `90-100: Exceptional match - meets all requirements with standout qualifications
80-89:  Strong match - meets most requirements with some exceptional areas  
70-79:  Good match - meets core requirements with minor gaps
60-69:  Moderate match - meets some requirements but has notable gaps
40-59:  Weak match - significant gaps in key requirements
0-39:   Poor match - major misalignment with job requirements`
          ]
        }),
        new PromptTemplateListNode<MATCHING_PTH>({
          semantic_type: 'rule', 
          content: 'Analysis Requirements:',
          children: [
            `Be specific about which requirements the candidate meets or misses`,
            `Highlight transferable skills even if not explicitly mentioned`,
            `Consider career progression and growth trajectory`,
            `Balance technical skills with soft skills and cultural fit`,
            `Provide actionable feedback for both hiring manager and candidate`
          ],
          list_label_function: (_req, _child, idx) => `${idx + 1}. `
        })
      ]
    });
  }

  get_Schema_Section(): PromptTemplateNode<MATCHING_PTH> {
    const schema_section = new PromptTemplateSectionNode<MATCHING_PTH>({
      semantic_type: 'schema',
      content: 'Output Schema:',
      children: []
    });

    const schemaSetNode = new PromptTemplateSchemaSetNode<MATCHING_PTH>({
      semantic_type: 'schema',
      content: "",
      children: []
    });

    schemaSetNode.addSchemas([MatchingResultSchema]);
    schema_section.add_child(schemaSetNode);
    return schema_section;
  }
}
```

## Assembling the Agent Bundle

### Constructor Registration

```typescript
import { FFConstructors } from '@firebrandanalytics/ff-agent-sdk';
import { JobDescription } from './entities/JobDescription.js';
import { Resume } from './entities/Resume.js';
import { MatchingScore } from './entities/MatchingScore.js';
import { RecruitingCollection } from './entities/RecruitingCollection.js';

export const RecruitingConstructors = {
  ...FFConstructors,
  'JobDescription': JobDescription,
  'Resume': Resume,
  'MatchingScore': MatchingScore,
  'RecruitingCollection': RecruitingCollection
} as const;
```

### Main Agent Bundle

```typescript
import {
  FFAgentBundle,
  logger,
  app_provider,
  HealthStatus
} from '@firebrandanalytics/ff-agent-sdk';
import { RecruitingConstructors } from './constructors.js';

export class RecruitingAgentBundle extends FFAgentBundle<any> {
  constructor() {
    super(
      {
        id: "d0000000-0000-0000-0001-000000000000",
        name: "RecruitingService", 
        description: "Job-to-resume matching service using FireFoundry"
      },
      RecruitingConstructors,
      app_provider
    );
  }

  override async init() {
    await super.init();
    logger.info("RecruitingAgentBundle initialized!");
    await this.create_sample_entities();
  }

  // /* boilerplate health check method skipped */

  private async create_sample_entities() {
    try {
      // Create main collection
      const collection_name = "recruiting-collection-root";
      const existing = await this.entity_client.get_node_by_name(collection_name);
      
      if (existing) {
        logger.info("Recruiting collection already exists:", existing.id);
        this.print_usage_examples(existing.id);
        return;
      }

      const collection_dto = await this.entity_client.create_node({
        name: collection_name,
        specific_type_name: 'RecruitingCollection',
        general_type_name: 'RecruitingCollection',
        status: 'Completed',
        data: {}
      });

      logger.info("Created recruiting collection:", collection_dto.id);
      this.print_usage_examples(collection_dto.id);
    } catch (error) {
      logger.error("Failed to create collection:", error);
    }
  }

  private print_usage_examples(collection_id: string) {
    logger.info("✅ Example API calls:");
    
    // Create job description
    logger.info(`# Create Job Description
curl -X POST http://localhost:3001/invoke \\
  -H "Content-Type: application/json" \\
  -d '{
    "entity_id": "${collection_id}",
    "method_name": "create_job_description",
    "args": [
      "Senior Software Engineer",
      "TechCorp",
      "We are seeking a Senior Software Engineer with 5+ years experience in Python, React, and AWS. Must have experience with microservices and agile development."
    ]
  }'`);

    // Create resume  
    logger.info(`# Create Resume
curl -X POST http://localhost:3001/invoke \\
  -H "Content-Type: application/json" \\
  -d '{
    "entity_id": "${collection_id}",
    "method_name": "create_resume", 
    "args": [
      "Jane Smith",
      "Software Engineer with 6 years experience in Python, JavaScript, and cloud platforms. Led development of scalable microservices at StartupXYZ. BS Computer Science from State University."
    ]
  }'`);

    // Create match
    logger.info(`# Create Match Analysis
curl -X POST http://localhost:3001/invoke \\
  -H "Content-Type: application/json" \\
  -d '{
    "entity_id": "${collection_id}",
    "method_name": "create_match",
    "args": ["JOB_DESCRIPTION_ID", "RESUME_ID"]
  }'`);
  }
}
```

## Creating the Collection Entity

The collection manages creating and connecting our entities:

```typescript
@EntityDecorator({
  specificType: 'RecruitingCollection',
  generalType: 'Class',
  allowedConnections: {
    'Contains': ['JobDescription', 'Resume', 'MatchingScore']
  }
})
export class RecruitingCollection extends EntityNode<
  EntityNodeTypeHelper<any, EntityNodeDTO, 'RecruitingCollection', {}, {}>
> {
  constructor(factory: EntityFactory<any>, idOrDto: UUID | EntityNodeDTO) {
    super(factory, idOrDto);
  }

  /**
   * Create a new job description
   */
  async create_job_description(
    title: string,
    company: string, 
    description_text: string,
    metadata?: Partial<JobDescriptionDTOData>
  ): Promise<{ entity_id: string; message: string }> {
    console.log(`💼 Creating job description: ${title} at ${company}`);

    const dto = await this.get_dto();
    const jd_dto = await this.factory.create_entity_node({
      app_id: dto.app_id!,
      name: `jd-${title.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`,
      specific_type_name: 'JobDescription',
      general_type_name: 'JobDescription',
      status: 'Completed',
      data: {
        title,
        company,
        description_text,
        posted_date: new Date().toISOString(),
        ...metadata
      }
    });

    // Connect to collection
    await this.connect_to({
      general_type_name: 'Edge',
      specific_type_name: 'Contains',
      to_node_id: jd_dto.id,
      to_node_type: 'JobDescription',
      data: { entity_type: 'job_description' }
    });

    console.log(`✅ Created job description: ${jd_dto.id}`);
    return { 
      entity_id: jd_dto.id, 
      message: `Created job description for ${title} at ${company}` 
    };
  }

  /**
   * Create a new resume
   */
  async create_resume(
    candidate_name: string,
    resume_text: string,
    metadata?: Partial<ResumeDTOData>
  ): Promise<{ entity_id: string; message: string }> {
    console.log(`👤 Creating resume for: ${candidate_name}`);

    const dto = await this.get_dto();
    const resume_dto = await this.factory.create_entity_node({
      app_id: dto.app_id!,
      name: `resume-${candidate_name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`,
      specific_type_name: 'Resume',
      general_type_name: 'Resume', 
      status: 'Completed',
      data: {
        candidate_name,
        resume_text,
        ...metadata
      }
    });

    // Connect to collection
    await this.connect_to({
      general_type_name: 'Edge',
      specific_type_name: 'Contains',
      to_node_id: resume_dto.id,
      to_node_type: 'Resume',
      data: { entity_type: 'resume' }
    });

    console.log(`✅ Created resume: ${resume_dto.id}`);
    return { 
      entity_id: resume_dto.id, 
      message: `Created resume for ${candidate_name}` 
    };
  }

  /**
   * Create a matching analysis between a job description and resume
   */
  async create_match(
    job_description_id: string,
    resume_id: string
  ): Promise<MatchingResult> {
    console.log(`🎯 Creating match analysis: ${job_description_id} ↔ ${resume_id}`);

    const dto = await this.get_dto();
    
    // Verify the JD and Resume exist
    const jd_entity = await this.factory.get_entity(job_description_id);
    const resume_entity = await this.factory.get_entity(resume_id);
    
    await jd_entity.load();
    await resume_entity.load();

    // Create the MatchingScore entity
    const match_dto = await this.factory.create_entity_node({
      app_id: dto.app_id!,
      name: `match-${Date.now()}`,
      specific_type_name: 'MatchingScore',
      general_type_name: 'MatchingScore',
      status: 'Pending',
      data: {
        job_description_id,
        resume_id,
        created_at: new Date().toISOString()
      }
    });

    // Get the matching entity instance
    const match_entity = await this.factory.get_entity(match_dto.id);

    // Connect the MatchingScore to both the JobDescription and Resume
    console.log(`🔗 Connecting match to job description and resume...`);
    
    // MatchingScore evaluates JobDescription
    await jd_entity.connect_to({
      general_type_name: 'Edge',
      specific_type_name: 'Evaluates',
      to_node_id: match_dto.id,
      to_node_type: 'MatchingScore',
      data: { evaluation_type: 'job_requirements' }
    });

    // MatchingScore evaluates Resume  
    await resume_entity.connect_to({
      general_type_name: 'Edge',
      specific_type_name: 'Evaluates',
      to_node_id: match_dto.id,
      to_node_type: 'MatchingScore',
      data: { evaluation_type: 'candidate_qualifications' }
    });

    // Connect match to collection for tracking
    await this.connect_to({
      general_type_name: 'Edge',
      specific_type_name: 'Contains',
      to_node_id: match_dto.id,
      to_node_type: 'MatchingScore',
      data: { entity_type: 'matching_analysis' }
    });

    // Run the matching analysis
    console.log(`🤖 Running matching analysis...`);
    const result = await match_entity.run();
    
    console.log('✅ Matching analysis complete');
    return result;
  }

  /**
   * Get all entities in this collection by type
   */
  async get_entities_by_type(entity_type: string): Promise<any[]> {
    await this.load();
    const contains_edges = (this.edges_from as any)['Contains'] || [];
    const filtered_edges = contains_edges.filter((edge: any) => 
      edge.data?.entity_type === entity_type
    );
    return Promise.all(
      filtered_edges.map((edge: any) => edge.get_to())
    );
  }

  async get_job_descriptions(): Promise<JobDescription[]> {
    return this.get_entities_by_type('job_description');
  }

  async get_resumes(): Promise<Resume[]> {
    return this.get_entities_by_type('resume');
  }

  async get_matches(): Promise<MatchingScore[]> {
    return this.get_entities_by_type('matching_analysis');
  }
}
```

## Complete Usage Flow

Here's how the entity graph works in practice:

### 1. Create Entities

```typescript
// Create job description
const jdResult = await agentClient.invoke_entity_method(
  collectionId,
  'create_job_description',
  'Senior Python Developer',
  'TechCorp',
  'Looking for 5+ years Python experience with Django, PostgreSQL, and AWS...'
);

// Create resume
const resumeResult = await agentClient.invoke_entity_method(
  collectionId,
  'create_resume',
  'Alice Johnson',
  'Python developer with 6 years experience building web applications with Django...'
);
```

### 2. Create Match Analysis

```typescript
// Trigger matching analysis
const matchResult = await agentClient.invoke_entity_method(
  collectionId,
  'create_match',
  jdResult.entity_id,    // Job description ID
  resumeResult.entity_id // Resume ID  
);

console.log('Match Results:', {
  score: matchResult.overall_score,
  recommendation: matchResult.recommendation,
  strengths: matchResult.key_strengths,
  gaps: matchResult.key_gaps
});
```

### 3. Entity Graph Structure

After creating matches, your entity graph looks like:

```
RecruitingCollection
├── Contains → JobDescription (Senior Python Developer)
├── Contains → Resume (Alice Johnson)  
├── Contains → MatchingScore (Analysis #1)
│
JobDescription ←─ Evaluates ─→ MatchingScore ←─ Evaluates ─→ Resume
```

This structure enables:
- **Bidirectional traversal**: Find all matches for a JD or Resume
- **Audit trail**: Every match is preserved with full context
- **Relationship queries**: Complex queries across the entity graph
- **Extensibility**: Easy to add more entity types and relationships

## Key Design Patterns

### 1. Computational Entities

`MatchingScore` represents both a computation and its result. This pattern is powerful because:
- The matching process itself becomes a queryable, persistent entity
- Full context is preserved (what was matched, when, with what result)
- Multiple matching algorithms can be implemented as different entity types
- Results can be re-computed, audited, or analyzed

### 2. Graph Traversal

Entities can traverse relationships to gather context:
```typescript
// From MatchingScore, get the connected JD and Resume
const { jobDescription, resume } = await matchingScore.get_match_context();
```

### 3. Factory Pattern

Collections act as factories, creating related entities and establishing connections:
```typescript
// Collection creates entities AND establishes relationships
const matchResult = await collection.create_match(jdId, resumeId);
```

## Next Steps and Extensions

Once you have the basic three-entity structure working, you can extend it:

### Additional Entities
- **Company**: Owns multiple JobDescriptions
- **Candidate**: Owns multiple Resumes, tracks application history
- **MatchingCampaign**: Bulk matching of one JD against multiple resumes
- **Interview**: Represents interview process, connected to high-scoring matches

### Advanced Relationships
- **Application**: Connects Candidate to JobDescription with application metadata
- **Ranking**: Ordered list of matches for a specific job
- **Feedback**: Interview feedback connected to matches

### Bulk Operations
- **Batch Matching**: One JD against 100+ resumes
- **Candidate Scoring**: One resume against multiple JDs
- **Portfolio Analysis**: Company-wide matching analytics

### Enhanced Matching
- **Multi-stage Matching**: Initial screening → detailed analysis → final scoring
- **Weighted Criteria**: Different weights for different job requirements
- **Learning Models**: Incorporate feedback to improve matching accuracy

The entity graph approach scales naturally from simple 1:1 matching to complex recruiting workflows while maintaining clear data relationships and audit trails.