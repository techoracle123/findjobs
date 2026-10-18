/**
 * Skill matching is deliberately forgiving: "Node.js", "node" and "NodeJS"
 * are the same skill, and "TS" means "TypeScript". Everything is normalised to
 * a canonical token before comparison so the match explanation can name the
 * skill the way the job posting did.
 */

const GROUPS: string[][] = [
  ['node', 'nodejs'],
  ['typescript', 'ts'],
  ['javascript', 'js', 'ecmascript'],
  ['react', 'reactjs'],
  ['next', 'nextjs'],
  ['vue', 'vuejs'],
  ['svelte', 'sveltekit'],
  ['angular', 'angularjs'],
  ['postgres', 'postgresql', 'psql'],
  ['mysql', 'mariadb'],
  ['mongodb', 'mongo'],
  ['redis', 'redisstack'],
  ['kubernetes', 'k8s', 'kube'],
  ['docker', 'containers', 'containerization'],
  ['aws', 'amazonwebservices'],
  ['gcp', 'googlecloud'],
  ['azure'],
  ['graphql', 'gql'],
  ['rest', 'restapi'],
  ['grpc'],
  ['terraform', 'iac', 'infrastructureascode'],
  ['cicd', 'continuousintegration', 'githubactions'],
  ['ml', 'machinelearning'],
  ['nlp', 'naturallanguageprocessing'],
  ['llm', 'largelanguagemodel'],
  ['pandas', 'numpy'],
  ['pytorch', 'torch'],
  ['tensorflow'],
  ['sql', 'sqlquery'],
  ['nosql'],
  ['dbt', 'dataengineering'],
  ['kafka', 'eventstreaming'],
  ['spark', 'pyspark'],
  ['airflow'],
  ['tailwind', 'tailwindcss'],
  ['css', 'css3'],
  ['html', 'html5'],
  ['sass', 'scss'],
  ['figma'],
  ['designsystems'],
  ['accessibility', 'a11y', 'wcag'],
  ['ux', 'uxresearch'],
  ['productmanagement', 'pm'],
  ['agile', 'scrum', 'kanban'],
  ['git', 'github', 'gitlab'],
  ['linux'],
  ['bash', 'shell'],
  ['python'],
  ['java', 'kotlin'],
  ['go', 'golang'],
  ['rust'],
  ['c', 'c++', 'cplusplus', 'cpp'],
  ['csharp', 'c#', 'dotnet'],
  ['php'],
  ['ruby', 'rails'],
  ['swift'],
  ['objectivec'],
  ['flutter', 'dart'],
  ['reactnative'],
  ['swiftui'],
  ['android'],
  ['ios'],
  ['security', 'infosec', 'applicationsecurity', 'appsec'],
  ['threatmodeling', 'threatmodelling'],
  ['pentest', 'penetrationtesting'],
  ['siem', 'soc'],
  ['gdpr', 'privacy'],
  ['payments', 'paymentsengineering'],
  ['elasticsearch'],
  ['opensearch'],
  ['wordpress'],
  ['shopify'],
  ['stripe'],
  ['twilio'],
  ['openai', 'gpt'],
  ['anthropic'],
  ['vectorsearch', 'embeddings'],
  ['rag'],
  ['pytest', 'unittest', 'junit'],
  ['cypress', 'playwright', 'selenium'],
  ['jest', 'vitest'],
  ['storybook'],
  ['webpack', 'vite', 'esbuild'],
]

const CANONICAL = new Map<string, string>()

function normalise(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9+#]/g, '')
}

for (const group of GROUPS) {
  const canonical = normalise(group[0])
  for (const member of group) {
    CANONICAL.set(normalise(member), canonical)
  }
}

export function canonicalSkill(raw: string): string {
  const token = normalise(raw)
  if (!token) return ''
  return CANONICAL.get(token) ?? token
}

export function skillsMatch(a: string, b: string): boolean {
  const left = canonicalSkill(a)
  const right = canonicalSkill(b)
  if (!left || !right) return false
  return left === right
}

export function matchSkills(jobSkills: string[], profileSkills: string[]) {
  const matched: string[] = []
  const missing: string[] = []
  const profileCanonical = new Set(profileSkills.map(canonicalSkill).filter(Boolean))

  for (const skill of jobSkills) {
    if (profileCanonical.has(canonicalSkill(skill))) matched.push(skill)
    else missing.push(skill)
  }

  return { matched, missing }
}

/**
 * A curated catalogue used by the deterministic CV keyword fallback. Each entry
 * lists the surface forms that indicate the skill, plus a rough weight so that
 * "kubernetes" outranks a passing mention of "git".
 */
export interface SkillPattern {
  label: string
  patterns: RegExp[]
  weight: number
}

/** Word-boundary match, for multi-word names and dotted names such as "Next.js". */
const word = (source: string) => new RegExp(`\\b${source}\\b`, 'i')

/**
 * Matches a short token only when it stands alone. A plain word boundary is
 * not enough here: "Node.js" contains a token "js" that must never be read as
 * a mention of JavaScript.
 */
const bare = (token: string) => new RegExp(`(?<![\\w.])${token}(?![\\w.])`, 'i')

/** Same as {@link bare}, but case-sensitive — used for language names. */
const exact = (token: string) => new RegExp(`(?<![\\w.])${token}(?![\\w.])`)

export const SKILL_CATALOGUE: SkillPattern[] = [
  { label: 'TypeScript', patterns: [word('typescript'), bare('ts')], weight: 6 },
  { label: 'JavaScript', patterns: [word('javascript'), bare('js')], weight: 5 },
  { label: 'Python', patterns: [word('python')], weight: 6 },
  { label: 'Go', patterns: [word('golang'), exact('Go')], weight: 5 },
  { label: 'Rust', patterns: [word('rust')], weight: 5 },
  { label: 'Java', patterns: [word('java')], weight: 4 },
  { label: 'Kotlin', patterns: [word('kotlin')], weight: 4 },
  { label: 'Ruby', patterns: [word('ruby'), word('rails')], weight: 4 },
  { label: 'PHP', patterns: [word('php'), word('laravel'), word('symfony')], weight: 4 },
  { label: 'C#', patterns: [word('c#'), word('\\.net\\b'), word('dotnet')], weight: 4 },
  { label: 'C++', patterns: [word('c\\+\\+')], weight: 4 },
  { label: 'Swift', patterns: [word('swift'), word('swiftui')], weight: 4 },
  { label: 'Dart', patterns: [word('dart'), word('flutter')], weight: 4 },
  { label: 'React', patterns: [word('react'), word('reactjs'), word('react\\.js')], weight: 6 },
  { label: 'Next.js', patterns: [word('next\\.js'), word('nextjs')], weight: 6 },
  { label: 'Vue', patterns: [word('vue'), word('vuejs')], weight: 5 },
  { label: 'Angular', patterns: [word('angular')], weight: 5 },
  { label: 'Svelte', patterns: [word('svelte')], weight: 4 },
  { label: 'Redux', patterns: [word('redux')], weight: 4 },
  { label: 'Node.js', patterns: [word('node\\.js'), word('nodejs'), bare('node')], weight: 6 },
  { label: 'Express', patterns: [word('express')], weight: 4 },
  { label: 'Django', patterns: [word('django')], weight: 4 },
  { label: 'FastAPI', patterns: [word('fastapi')], weight: 4 },
  { label: 'Spring', patterns: [word('spring boot'), word('springboot')], weight: 4 },
  { label: 'GraphQL', patterns: [word('graphql')], weight: 5 },
  { label: 'REST', patterns: [word('rest\\s*api'), word('restful')], weight: 4 },
  { label: 'gRPC', patterns: [word('grpc')], weight: 4 },
  {
    label: 'PostgreSQL',
    patterns: [word('postgres'), word('postgresql'), word('psql')],
    weight: 6,
  },
  { label: 'MySQL', patterns: [word('mysql'), word('mariadb')], weight: 5 },
  { label: 'MongoDB', patterns: [word('mongodb'), word('mongo')], weight: 5 },
  { label: 'Redis', patterns: [word('redis')], weight: 4 },
  { label: 'Elasticsearch', patterns: [word('elasticsearch'), word('opensearch')], weight: 4 },
  { label: 'SQL', patterns: [word('sql')], weight: 5 },
  { label: 'dbt', patterns: [word('dbt')], weight: 5 },
  { label: 'Airflow', patterns: [word('airflow')], weight: 4 },
  { label: 'Spark', patterns: [word('spark')], weight: 4 },
  { label: 'Kafka', patterns: [word('kafka')], weight: 5 },
  { label: 'Pandas', patterns: [word('pandas')], weight: 5 },
  { label: 'NumPy', patterns: [word('numpy')], weight: 4 },
  { label: 'PyTorch', patterns: [word('pytorch'), word('\\btorch\\b')], weight: 5 },
  { label: 'TensorFlow', patterns: [word('tensorflow')], weight: 5 },
  { label: 'Machine learning', patterns: [word('machine learning'), bare('ml')], weight: 6 },
  { label: 'NLP', patterns: [word('nlp'), word('natural language')], weight: 5 },
  { label: 'LLM', patterns: [bare('llms?'), word('large language model')], weight: 6 },
  { label: 'RAG', patterns: [bare('rag'), word('retrieval[- ]augmented')], weight: 5 },
  { label: 'Kubernetes', patterns: [word('kubernetes'), word('k8s')], weight: 6 },
  { label: 'Docker', patterns: [word('docker'), word('container')], weight: 5 },
  { label: 'Terraform', patterns: [word('terraform'), word('infrastructure as code')], weight: 5 },
  { label: 'AWS', patterns: [word('aws'), word('amazon web services')], weight: 6 },
  { label: 'GCP', patterns: [word('gcp'), word('google cloud')], weight: 5 },
  { label: 'Azure', patterns: [word('azure')], weight: 5 },
  {
    label: 'CI/CD',
    patterns: [word('ci/cd'), word('cicd'), word('continuous integration'), word('github actions')],
    weight: 5,
  },
  { label: 'Linux', patterns: [word('linux')], weight: 4 },
  { label: 'Bash', patterns: [word('bash'), word('shell script')], weight: 3 },
  { label: 'Git', patterns: [word('git'), word('github'), word('gitlab')], weight: 4 },
  { label: 'React Native', patterns: [word('react native'), word('reactnative')], weight: 5 },
  { label: 'Flutter', patterns: [word('flutter')], weight: 4 },
  { label: 'Android', patterns: [word('android')], weight: 4 },
  { label: 'iOS', patterns: [word('ios')], weight: 4 },
  {
    label: 'Security',
    patterns: [
      word('appsec'),
      word('application security'),
      word('infosec'),
      word('penetration test'),
    ],
    weight: 5,
  },
  { label: 'Threat modeling', patterns: [word('threat model')], weight: 5 },
  {
    label: 'Payments',
    patterns: [word('payments'), word('stripe'), word('payment processing')],
    weight: 4,
  },
  {
    label: 'Accessibility',
    patterns: [word('accessibility'), word('a11y'), word('wcag')],
    weight: 4,
  },
  { label: 'Figma', patterns: [word('figma')], weight: 4 },
  { label: 'Design systems', patterns: [word('design system')], weight: 4 },
  {
    label: 'Product management',
    patterns: [word('product management'), word('product owner'), word('roadmap')],
    weight: 4,
  },
  { label: 'Agile', patterns: [word('agile'), word('scrum'), word('kanban')], weight: 3 },
  { label: 'Tailwind CSS', patterns: [word('tailwind')], weight: 4 },
  { label: 'Storybook', patterns: [word('storybook')], weight: 3 },
  {
    label: 'Playwright',
    patterns: [word('playwright'), word('cypress'), word('selenium')],
    weight: 4,
  },
  { label: 'Pytest', patterns: [word('pytest'), word('unit test')], weight: 3 },
  { label: 'GDPR', patterns: [word('gdpr'), word('data protection')], weight: 4 },
]

export const ROLE_FAMILY_KEYWORDS: { family: string; patterns: RegExp[] }[] = [
  { family: 'frontend', patterns: [word('frontend'), word('front[- ]end'), word('ui engineer')] },
  { family: 'backend', patterns: [word('backend'), word('back[- ]end'), word('api engineer')] },
  { family: 'fullstack', patterns: [word('full[- ]?stack')] },
  {
    family: 'data',
    patterns: [
      word('data analyst'),
      word('data engineer'),
      word('data scientist'),
      word('data science'),
      word('analytics'),
      bare('bi'),
    ],
  },
  {
    family: 'ml',
    patterns: [word('machine learning'), word('ml engineer'), word('deep learning'), bare('ml')],
  },
  {
    family: 'platform',
    patterns: [
      word('platform engineer'),
      word('developer platform'),
      word('internal developer platform'),
    ],
  },
  {
    family: 'devops',
    patterns: [
      word('devops'),
      word('site reliability'),
      word('sre'),
      word('infrastructure engineer'),
    ],
  },
  {
    family: 'security',
    patterns: [
      word('security engineer'),
      word('appsec'),
      word('infosec'),
      word('security analyst'),
    ],
  },
  {
    family: 'product',
    patterns: [word('product manager'), word('product management'), word('product owner')],
  },
  {
    family: 'design',
    patterns: [
      word('designer'),
      word('design lead'),
      word('ux researcher'),
      word('product design'),
    ],
  },
  {
    family: 'qa',
    patterns: [word('qa engineer'), word('quality assurance'), word('test engineer')],
  },
  {
    family: 'mobile',
    patterns: [word('mobile engineer'), word('ios engineer'), word('android engineer')],
  },
]

export const SENIORITY_KEYWORDS: { level: string; patterns: RegExp[] }[] = [
  { level: 'intern', patterns: [word('intern'), word('internship')] },
  { level: 'junior', patterns: [word('junior'), word('graduate'), word('entry[- ]level')] },
  { level: 'mid', patterns: [word('mid[- ]level'), word('intermediate')] },
  { level: 'senior', patterns: [word('senior'), bare('sr')] },
  { level: 'staff', patterns: [word('staff'), word('principal engineer'), word('distinguished')] },
  { level: 'lead', patterns: [word('tech lead'), word('engineering lead'), word('team lead')] },
  {
    level: 'principal',
    patterns: [word('principal'), word('fellow'), word('head of engineering')],
  },
]

export const WORK_MODE_KEYWORDS: { mode: string; patterns: RegExp[] }[] = [
  { mode: 'remote', patterns: [word('remote'), word('fully distributed'), word('work from home')] },
  { mode: 'hybrid', patterns: [word('hybrid'), word('[23] days? in (the )?office')] },
  { mode: 'onsite', patterns: [word('on[- ]?site'), word('in office'), word('on[- ]?premise')] },
]
