/**
 * Expanded skill dictionary for extraction. Entries carry safe free-text
 * aliases; ambiguous short forms only match source-provided tags, so "go" in
 * prose never becomes the Go language. Wave 2 replaces this with the full
 * taxonomy package; the extractor interface stays the same.
 */

export interface SkillEntry {
  name: string
  category: string
  /** Safe to match in free prose. */
  textAliases: string[]
  /** Only trusted from a source's own tags, where tokens are deliberate. */
  tagAliases?: string[]
}

const entry = (
  name: string,
  category: string,
  textAliases: string[],
  tagAliases: string[] = [],
): SkillEntry => ({ name, category, textAliases, tagAliases })

export const SKILL_DICTIONARY: SkillEntry[] = [
  // Languages
  entry('JavaScript', 'languages', ['javascript', 'ecmascript', 'es6', 'es2015'], ['js']),
  entry('TypeScript', 'languages', ['typescript'], ['ts']),
  entry('Python', 'languages', ['python', 'python3', 'python 3'], ['py']),
  entry('Java', 'languages', ['java', 'jdk', 'jvm']),
  entry('Kotlin', 'languages', ['kotlin']),
  entry('Swift', 'languages', ['swift', 'swiftui']),
  entry('Go', 'languages', ['golang'], ['go']),
  entry('Rust', 'languages', ['rust', 'rustlang']),
  entry('Ruby', 'languages', ['ruby on rails', 'ruby'], ['ruby']),
  entry('PHP', 'languages', ['php']),
  entry('C#', 'languages', ['c#', 'csharp', 'asp.net', '.net', 'dotnet']),
  entry('C++', 'languages', ['c++', 'cplusplus']),
  entry('Scala', 'languages', ['scala']),
  entry('Elixir', 'languages', ['elixir', 'phoenix framework']),
  entry('Dart', 'languages', ['dart']),
  entry('R', 'languages', ['r language', 'r programming', 'rstudio'], ['r']),
  entry('SQL', 'languages', ['sql', 't-sql', 'pl/sql', 'postgresql query']),
  entry('Bash', 'languages', ['bash', 'shell scripting', 'shell script']),
  entry('PowerShell', 'languages', ['powershell']),
  entry('HTML', 'languages', ['html', 'html5']),
  entry('CSS', 'languages', ['css', 'css3']),
  entry('GraphQL', 'languages', ['graphql', 'apollo graphql']),
  // Frontend
  entry('React', 'frontend', ['react', 'react.js', 'reactjs', 'react native']),
  entry('Next.js', 'frontend', ['next.js', 'nextjs']),
  entry('Vue.js', 'frontend', ['vue', 'vue.js', 'vuejs', 'nuxt']),
  entry('Angular', 'frontend', ['angular', 'angularjs']),
  entry('Svelte', 'frontend', ['svelte', 'sveltekit']),
  entry('Redux', 'frontend', ['redux']),
  entry('Tailwind CSS', 'frontend', ['tailwind', 'tailwind css', 'tailwindcss']),
  entry('Figma', 'frontend', ['figma']),
  entry('Webpack', 'frontend', ['webpack', 'vite', 'esbuild', 'rollup']),
  entry('Jest', 'frontend', ['jest', 'vitest', 'testing library']),
  entry('Cypress', 'frontend', ['cypress']),
  entry('Playwright', 'frontend', ['playwright']),
  entry('Storybook', 'frontend', ['storybook']),
  entry('Flutter', 'frontend', ['flutter']),
  entry('Three.js', 'frontend', ['three.js', 'threejs', 'webgl']),
  // Backend
  entry('Node.js', 'backend', ['node.js', 'nodejs', 'node js'], ['node']),
  entry('Express', 'backend', ['express', 'express.js', 'expressjs']),
  entry('NestJS', 'backend', ['nestjs', 'nest.js']),
  entry('Django', 'backend', ['django']),
  entry('Flask', 'backend', ['flask']),
  entry('FastAPI', 'backend', ['fastapi', 'fast api']),
  entry('Spring Boot', 'backend', ['spring boot', 'springboot', 'spring framework']),
  entry('Laravel', 'backend', ['laravel']),
  entry('Ruby on Rails', 'backend', ['rails', 'ror', 'ruby on rails']),
  entry('ASP.NET', 'backend', ['asp.net', 'aspnet', 'dotnet core', '.net core']),
  entry('gRPC', 'backend', ['grpc']),
  entry('REST APIs', 'backend', ['rest api', 'rest apis', 'restful', 'rest endpoints']),
  entry('Microservices', 'backend', ['microservices', 'micro-services', 'microservice']),
  entry('Serverless', 'backend', ['serverless', 'lambda functions', 'cloud functions']),
  entry('Kafka', 'backend', ['kafka', 'apache kafka', 'event streaming']),
  entry('RabbitMQ', 'backend', ['rabbitmq', 'rabbit mq', 'message queue', 'message broker']),
  entry('Redis', 'backend', ['redis']),
  entry('WebSockets', 'backend', ['websocket', 'websockets', 'socket.io']),
  // Databases
  entry('PostgreSQL', 'database', ['postgres', 'postgresql'], ['psql']),
  entry('MySQL', 'database', ['mysql', 'mariadb']),
  entry('MongoDB', 'database', ['mongodb', 'mongo db'], ['mongo']),
  entry('Elasticsearch', 'database', ['elasticsearch', 'elastic search', 'opensearch', 'kibana']),
  entry('DynamoDB', 'database', ['dynamodb', 'dynamo db']),
  entry('Snowflake', 'database', ['snowflake']),
  entry('BigQuery', 'database', ['bigquery', 'big query', 'google bigquery']),
  entry('ClickHouse', 'database', ['clickhouse', 'click house']),
  entry('SQLite', 'database', ['sqlite']),
  entry('Supabase', 'database', ['supabase']),
  entry('Firebase', 'database', ['firebase', 'firestore']),
  entry('Prisma', 'database', ['prisma', 'prisma orm']),
  entry('SQLAlchemy', 'database', ['sqlalchemy', 'sequelize', 'typeorm', 'hibernate']),
  // DevOps / Cloud
  entry('AWS', 'cloud', ['aws', 'amazon web services', 'ec2', 's3 bucket', 'aws lambda']),
  entry('Azure', 'cloud', ['azure', 'microsoft azure']),
  entry('Google Cloud', 'cloud', ['gcp', 'google cloud', 'google cloud platform'], ['gcp']),
  entry('Docker', 'cloud', ['docker', 'containerization', 'containers']),
  entry('Kubernetes', 'cloud', ['kubernetes', 'k8s'], ['k8s']),
  entry('Terraform', 'cloud', ['terraform', 'infrastructure as code', 'iac']),
  entry('Ansible', 'cloud', ['ansible', 'chef', 'puppet']),
  entry('CI/CD', 'cloud', [
    'ci/cd',
    'cicd',
    'continuous integration',
    'continuous delivery',
    'jenkins',
    'github actions',
    'gitlab ci',
    'circleci',
    'argocd',
    'azure devops',
  ]),
  entry('Prometheus', 'cloud', ['prometheus', 'grafana']),
  entry('Datadog', 'cloud', ['datadog', 'new relic', 'splunk cloud']),
  entry('Sentry', 'cloud', ['sentry']),
  entry('Nginx', 'cloud', ['nginx', 'apache http server']),
  entry('Linux', 'cloud', ['linux', 'ubuntu', 'centos', 'redhat', 'red hat', 'unix']),
  entry('Cloudflare', 'cloud', ['cloudflare', 'cloudflare workers', 'cloudflare pages']),
  entry('Vercel', 'cloud', ['vercel', 'netlify']),
  entry('Git', 'cloud', ['git', 'github', 'gitlab', 'bitbucket', 'version control']),
  // Cybersecurity
  entry('Cybersecurity', 'security', [
    'cyber security',
    'cybersecurity',
    'information security',
    'infosec',
    'info sec',
  ]),
  entry('Penetration Testing', 'security', [
    'penetration testing',
    'penetration test',
    'pentest',
    'pentesting',
    'ethical hacking',
    'white hat',
  ]),
  entry('Vulnerability Assessment', 'security', [
    'vulnerability assessment',
    'vulnerability management',
    'vulnerability scanning',
  ]),
  entry('SIEM', 'security', ['siem', 'security information and event management']),
  entry('Splunk', 'security', ['splunk']),
  entry('QRadar', 'security', ['qradar']),
  entry('Microsoft Sentinel', 'security', ['microsoft sentinel', 'azure sentinel']),
  entry('Metasploit', 'security', ['metasploit']),
  entry('Burp Suite', 'security', ['burp suite', 'burpsuite', 'burp']),
  entry('Nmap', 'security', ['nmap', 'wireshark', 'nessus', 'qualys']),
  entry('Kali Linux', 'security', ['kali linux', 'kali']),
  entry('Threat Modeling', 'security', ['threat modeling', 'threat modelling', 'threat analysis']),
  entry('Incident Response', 'security', [
    'incident response',
    'incident handling',
    'security incident',
  ]),
  entry('Digital Forensics', 'security', [
    'digital forensics',
    'computer forensics',
    'forensic analysis',
  ]),
  entry('Malware Analysis', 'security', [
    'malware analysis',
    'malware reverse engineering',
    'reverse engineering',
  ]),
  entry('SOC', 'security', [
    'soc analyst',
    'security operations center',
    'security operations centre',
    'soc operations',
  ]),
  entry('IAM', 'security', ['identity and access management', 'iam', 'privileged access']),
  entry('OAuth', 'security', ['oauth', 'oauth2', 'saml', 'sso', 'single sign-on']),
  entry('PKI', 'security', ['pki', 'cryptography', 'tls', 'ssl', 'encryption']),
  entry('WAF', 'security', [
    'waf',
    'web application firewall',
    'firewall management',
    'ddos mitigation',
  ]),
  entry('Network Security', 'security', ['network security', 'network defense', 'network defence']),
  entry('Application Security', 'security', [
    'application security',
    'appsec',
    'app sec',
    'secure coding',
    'owasp',
  ]),
  entry('DevSecOps', 'security', [
    'devsecops',
    'dev sec ops',
    'sast',
    'dast',
    'security by design',
  ]),
  entry('ISO 27001', 'security', [
    'iso 27001',
    'iso27001',
    'nist',
    'soc 2',
    'soc2',
    'pci dss',
    'pci-dss',
  ]),
  entry('GDPR', 'security', ['gdpr', 'data protection', 'privacy compliance', 'ndpr']),
  entry('CISSP', 'security', ['cissp', 'cism', 'ceh', 'oscp', 'comptia security+', 'security+']),
  entry('Zero Trust', 'security', ['zero trust', 'zero-trust', 'edr', 'xdr', 'endpoint detection']),
  entry('Cloud Security', 'security', [
    'cloud security',
    'container security',
    'kubernetes security',
  ]),
  entry('Red Team', 'security', [
    'red team',
    'blue team',
    'purple team',
    'threat intelligence',
    'phishing analysis',
  ]),
  entry('GRC', 'security', [
    'governance risk and compliance',
    'grc',
    'risk assessment',
    'risk management',
    'security awareness',
  ]),
  // Data & Analytics
  entry('Data Analysis', 'data', [
    'data analysis',
    'data analytics',
    'data analyst',
    'analytical skills',
    'analyse data',
    'analyze data',
  ]),
  entry('Data Engineering', 'data', [
    'data engineering',
    'data engineer',
    'data pipelines',
    'etl',
    'elt',
  ]),
  entry('Data Science', 'data', [
    'data science',
    'data scientist',
    'statistical analysis',
    'statistics',
  ]),
  entry('Machine Learning', 'data', [
    'machine learning',
    'ml models',
    'ml engineering',
    'predictive modelling',
    'predictive modeling',
  ]),
  entry('Deep Learning', 'data', [
    'deep learning',
    'neural networks',
    'nlp',
    'natural language processing',
    'computer vision',
  ]),
  entry('PyTorch', 'data', [
    'pytorch',
    'tensorflow',
    'keras',
    'scikit-learn',
    'sklearn',
    'xgboost',
  ]),
  entry('Pandas', 'data', ['pandas', 'numpy', 'scipy', 'polars']),
  entry('Apache Spark', 'data', ['spark', 'pyspark', 'hadoop', 'hive', 'databricks']),
  entry('Airflow', 'data', ['airflow', 'apache airflow', 'dagster', 'prefect', 'luigi']),
  entry('dbt', 'data', ['dbt', 'data build tool']),
  entry('Tableau', 'data', [
    'tableau',
    'power bi',
    'powerbi',
    'looker',
    'qlik',
    'metabase',
    'superset',
  ]),
  entry('Excel', 'data', [
    'excel',
    'microsoft excel',
    'spreadsheets',
    'pivot tables',
    'vlookup',
    'google sheets',
  ]),
  entry('Google Analytics', 'data', ['google analytics', 'ga4', 'mixpanel', 'amplitude', 'hotjar']),
  entry('A/B Testing', 'data', [
    'a/b testing',
    'ab testing',
    'split testing',
    'hypothesis testing',
    'experimentation',
  ]),
  entry('Data Visualization', 'data', [
    'data visualisation',
    'data visualization',
    'data storytelling',
    'dashboard design',
  ]),
  entry('Data Warehousing', 'data', [
    'data warehouse',
    'data warehousing',
    'data modelling',
    'data modeling',
    'dimensional modeling',
  ]),
  entry('Data Governance', 'data', [
    'data governance',
    'data quality',
    'data lineage',
    'master data management',
  ]),
  // Product & Design
  entry('Product Management', 'product', [
    'product management',
    'product manager',
    'product strategy',
    'roadmap planning',
    'roadmapping',
    'product owner',
  ]),
  entry('User Research', 'product', [
    'user research',
    'ux research',
    'usability testing',
    'user interviews',
  ]),
  entry('UI Design', 'product', [
    'ui design',
    'user interface design',
    'interaction design',
    'visual design',
    'wireframing',
    'prototyping',
  ]),
  entry('UX Design', 'product', [
    'ux design',
    'user experience design',
    'information architecture',
    'design thinking',
  ]),
  entry('Design Systems', 'product', [
    'design systems',
    'design system',
    'component library',
    'adobe xd',
    'sketch app',
  ]),
  entry('Accessibility', 'product', ['accessibility', 'wcag', 'a11y', 'inclusive design']),
  entry('Agile', 'product', ['agile', 'scrum', 'kanban', 'sprint planning', 'safe agile']),
  entry('Jira', 'product', ['jira', 'confluence', 'notion', 'asana', 'trello', 'monday.com']),
  // Business & soft skills
  entry('Project Management', 'business', [
    'project management',
    'project manager',
    'project planning',
    'project coordination',
    'pmp',
  ]),
  entry('Stakeholder Management', 'business', [
    'stakeholder management',
    'stakeholder engagement',
    'cross-functional collaboration',
  ]),
  entry('Communication', 'business', [
    'communication skills',
    'written communication',
    'verbal communication',
    'presentation skills',
    'public speaking',
  ]),
  entry('Leadership', 'business', [
    'leadership',
    'team leadership',
    'people management',
    'line management',
    'mentoring',
    'coaching',
  ]),
  entry('Negotiation', 'business', ['negotiation', 'negotiating', 'conflict resolution']),
  entry('Budgeting', 'business', [
    'budgeting',
    'budget management',
    'financial modelling',
    'financial modeling',
    'financial planning',
    'forecasting',
  ]),
  entry('Sales', 'business', [
    'sales',
    'business development',
    'account management',
    'account executive',
    'lead generation',
    'cold calling',
    'crm',
  ]),
  entry('Customer Success', 'business', [
    'customer success',
    'customer service',
    'customer support',
    'client relations',
    'account servicing',
  ]),
  entry('Digital Marketing', 'business', [
    'digital marketing',
    'online marketing',
    'performance marketing',
    'paid advertising',
    'google ads',
    'facebook ads',
  ]),
  entry('SEO', 'business', [
    'seo',
    'search engine optimisation',
    'search engine optimization',
    'sem',
    'search engine marketing',
  ]),
  entry('Content Marketing', 'business', [
    'content marketing',
    'content strategy',
    'content creation',
    'copywriting',
    'blogging',
    'social media marketing',
    'email marketing',
  ]),
  entry('Recruitment', 'business', [
    'recruitment',
    'talent acquisition',
    'hiring',
    'sourcing',
    'headhunting',
    'hr operations',
  ]),
  entry('Supply Chain', 'business', [
    'supply chain',
    'procurement',
    'logistics',
    'inventory management',
    'warehouse management',
  ]),
  entry('Accounting', 'business', [
    'accounting',
    'bookkeeping',
    'financial reporting',
    'auditing',
    'tax preparation',
    'quickbooks',
    'sap fico',
  ]),
  entry('Office Administration', 'business', [
    'office administration',
    'administrative support',
    'data entry',
    'clerical',
    'office management',
    'microsoft office',
    'microsoft word',
    'microsoft powerpoint',
  ]),
  entry('Teaching', 'business', [
    'teaching',
    'curriculum development',
    'lesson planning',
    'tutoring',
    'training and development',
  ]),
  entry('Nursing', 'healthcare', [
    'nursing',
    'patient care',
    'clinical care',
    'registered nurse',
    'midwifery',
  ]),
  entry('Healthcare', 'healthcare', [
    'healthcare',
    'medical',
    'clinical',
    'pharmacy',
    'physiotherapy',
    'public health',
  ]),
  entry('Hospitality', 'hospitality', [
    'hospitality',
    'hotel management',
    'food and beverage',
    'customer hospitality',
    'front desk',
  ]),
  entry('Driving', 'logistics', [
    'driving',
    'driver licence',
    'driver license',
    'fleet management',
    'route planning',
  ]),
  entry('Video Editing', 'creative', [
    'video editing',
    'video editor',
    'premiere pro',
    'after effects',
    'final cut pro',
    'davinci resolve',
  ]),
  entry('Graphic Design', 'creative', [
    'graphic design',
    'graphic designer',
    'illustrator',
    'photoshop',
    'indesign',
    'coreldraw',
  ]),
  entry('Photography', 'creative', [
    'photography',
    'videography',
    'photographer',
    'camera operation',
  ]),
  entry('Writing', 'creative', [
    'technical writing',
    'content writing',
    'creative writing',
    'copywriting',
    'editing',
    'proofreading',
  ]),
]

/** Compiles safe free-text matchers once. */
const TEXT_MATCHERS: { name: string; regex: RegExp }[] = []
for (const skill of SKILL_DICTIONARY) {
  for (const alias of skill.textAliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    TEXT_MATCHERS.push({
      name: skill.name,
      regex: new RegExp(`(?<![\\w#+.])${escaped}(?![\\w#+.])`, 'i'),
    })
  }
}

export interface SkillMatch {
  name: string
  required: boolean
  confidence: number
  sentence: string
}

/** Heading lines that mark the requirements section of a listing. */
const REQUIRED_HEADING =
  /\b(requirements?|what (we|you) (expect|need|require)|must[- ]have|qualifications?|who you are|what you'?ll need|essentials?|minimum requirements?)\b/i
const PREFERRED_HEADING =
  /\b(nice to (have|know)|bonus|preferred|good to (have|know)|desirable|added advantage|it'?s a plus|would be (a )?plus)\b/i

function sectionOf(
  line: string,
  current: 'required' | 'preferred' | 'unknown',
): 'required' | 'preferred' | 'unknown' {
  if (REQUIRED_HEADING.test(line)) return 'required'
  if (PREFERRED_HEADING.test(line)) return 'preferred'
  return current
}

/**
 * Extracts skills with the sentence that triggered each match. A skill counts
 * as required only when its sentence sits under a requirements heading; when
 * the structure is unclear it is never promoted to required.
 */
export function extractSkills(text: string, tags: string[] = []): SkillMatch[] {
  const matches = new Map<string, SkillMatch>()
  const tagHaystack = tags.join(' ').toLowerCase()

  for (const skill of SKILL_DICTIONARY) {
    const tagHit = [...skill.textAliases, ...(skill.tagAliases ?? [])].some((alias) =>
      tagHaystack.includes(alias.toLowerCase()),
    )
    if (tagHit && !matches.has(skill.name))
      matches.set(skill.name, {
        name: skill.name,
        required: false,
        confidence: 0.9,
        sentence: 'Source-provided tag',
      })
  }

  let section: 'required' | 'preferred' | 'unknown' = 'unknown'
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.trim()
    if (!line) continue
    const previous: 'required' | 'preferred' | 'unknown' = section
    section = sectionOf(line, section)
    // A heading names a section; it is not itself skill evidence.
    if (section !== previous && (REQUIRED_HEADING.test(line) || PREFERRED_HEADING.test(line)))
      continue
    for (const matcher of TEXT_MATCHERS) {
      if (matches.has(matcher.name)) continue
      if (matcher.regex.test(line)) {
        matches.set(matcher.name, {
          name: matcher.name,
          required: section === 'required',
          confidence: section === 'unknown' ? 0.6 : 0.85,
          sentence: line.slice(0, 240),
        })
      }
    }
    if (matches.size >= 24) break
  }
  return [...matches.values()]
}
