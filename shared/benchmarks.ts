import type { Benchmark } from './types';

export const benchmarks: Benchmark[] = [
  {
    id: 'B01',
    title: 'Find the right revision',
    description: 'Identify an eligible revision and see the evidence behind it.',
    mode: 'ASK',
    intent: 'revision',
    prompt:
      'Which revision of SYN-COOL-100 is admissible for a component review under the supplied review policy?',
  },
  {
    id: 'B02',
    title: 'Understand the assembly',
    description: 'Inspect a configured structure without double-counting references.',
    mode: 'INVESTIGATE',
    intent: 'structure',
    prompt:
      'For SYN-COOL-100 revision B in BENCH-48V, how many fan occurrences and unique references are included?',
  },
  {
    id: 'B03',
    title: 'Inspect a design change',
    description: 'Compare controller revisions and trace the affected requirements.',
    mode: 'INVESTIGATE',
    intent: 'compare',
    prompt:
      'Compare controller SYN-CTRL-100 revisions A and B. Which interface requirements need review?',
  },
  {
    id: 'B04',
    title: 'Check qualification evidence',
    description: 'Separate current evidence from assumptions and missing tests.',
    mode: 'INVESTIGATE',
    intent: 'qualification',
    prompt:
      'Is material M2 qualified to replace M1 on BENCH-48V? Check current and superseded evidence.',
  },
  {
    id: 'B05',
    title: 'Prepare a component review',
    description: 'Draft a review request grounded in evidence, with no platform writes.',
    mode: 'ACT',
    intent: 'prepare',
    prompt:
      'Prepare a component review for material M2 substitution on SYN-COOL-100 in BENCH-48V. Do not submit it.',
  },
];
