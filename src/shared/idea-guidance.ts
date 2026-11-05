import type { IdeaFormat } from './ideas'

export interface IdeaGuidance {
  intro: string
  steps: string[]
  tools: string[]
  costs: string[]
}

const guides: Record<IdeaFormat, IdeaGuidance> = {
  software: {
    intro:
      'Start with a simple website that works on a phone. You do not need an Android or iPhone app on day one.',
    steps: [
      'Draw the main screens on paper. Show only what a customer needs to finish one task.',
      'Build the smallest working version. If you cannot code, ask a developer to help with this small version only.',
      'Watch one possible customer use it without explaining every step. Write down where they get stuck.',
      'Fix the confusing parts. Consider an Android or iPhone app only when users need one.',
    ],
    tools: [
      'A computer or phone',
      'Paper for the screen plan',
      'A spreadsheet or simple website tool for the first test',
      'One person who will test it honestly',
    ],
    costs: [
      'Your time or a developer’s fee',
      'Website hosting and internet data',
      'A domain name if you choose to buy one',
      'Customer support and ongoing fixes',
    ],
  },
  physical: {
    intro: 'Start with one sample or a small batch. Do not buy a large amount of stock yet.',
    steps: [
      'List the parts, supplies and safety checks needed for the first version.',
      'Make or buy one sample. Check its quality, warranty and return terms.',
      'Ask one possible customer to use it for a real task in a safe place.',
      'Record what broke, what was missing and what the customer would change.',
    ],
    tools: [
      'One sample or a small batch',
      'A safe place to test it',
      'Supplier, warranty and safety documents',
      'A notebook for costs and customer feedback',
    ],
    costs: [
      'Samples, parts and packaging',
      'Transport and delivery',
      'Safety checks, permits or expert help',
      'Repairs, returns and replacements',
    ],
  },
  hybrid: {
    intro:
      'Test the physical product and the software separately before joining them. Keep the first software feature small.',
    steps: [
      'List the physical parts and the software job separately. Check who will keep each part working.',
      'Test the physical product on its own. Fix safety or quality problems first.',
      'Add one simple software feature, such as a reminder, reading or service record.',
      'Ask a qualified user to test the whole product and explain anything that is unclear.',
    ],
    tools: [
      'One physical sample',
      'A safe place to test it',
      'A simple website, app or spreadsheet for the software part',
      'Someone with the right technical or safety knowledge',
    ],
    costs: [
      'Parts, samples and packaging',
      'Software setup, hosting and internet data',
      'Safety checks, permits or expert help',
      'Repairs, replacements and software fixes',
    ],
  },
}

export function getIdeaGuidance(format: IdeaFormat): IdeaGuidance {
  return guides[format]
}
