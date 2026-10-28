import { defineConfig } from 'vitest/config'

/**
 * Unit tests for the pure domain logic. These run in plain Node because they
 * touch no bindings — scoring, eligibility, conversion and skill matching.
 */
export default defineConfig({
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
