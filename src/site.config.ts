/**
 * Everything the site used to read from the `SiteSetting` and `StackItem`
 * tables.
 *
 * Those were two tables, two admin pages, six actions and a reorder endpoint,
 * maintaining values that change less often than the code does. They are
 * constants now: versioned with the site, reviewable in a diff, and impossible
 * to leave half-populated the way an empty settings table quietly did.
 *
 * The trade is real and worth stating: editing the bio needs a deploy. That is
 * the deal the static build makes everywhere else on this site too.
 */

export interface StackGroup {
  name: string;
  items: string[];
}

/**
 * The hero line, under the name.
 *
 * Taken from the resume's professional summary rather than written fresh.
 * AGENT §6 forbids inventing biography, and "14+ years" is a claim only the
 * resume can source — so it is quoted from there, trimmed to one sentence.
 */
export const thesis =
  "Software engineer, 14+ years. Blockchain and backend, full-stack web, smart contracts, and AI-powered products.";

/**
 * The Background section.
 *
 * Casual in register, but every fact still traces to the resume — the years,
 * the employers, the ecosystems, the certifications. AGENT §6's rule does not
 * relax because the tone did.
 *
 * The closing point about tooling is the one thing here that is a position
 * rather than a credential, and it is deliberate: a stack list invites the
 * reading that anything absent from it is off the table.
 */
export const about =
  "Fourteen years of building software, and most of it has been learning the next thing. Lately that's blockchain and AI: smart contracts and indexers on EVM chains, work in the Solana and Stellar ecosystems, and the backends, APIs and frontends wrapped around them. Before that, developer experience at Whispir, custody infrastructure at Ripple, platform work at Nixplay, and running DevOps at Krisp Systems. I've been a Developer Relations Engineer for Solana Superteam Philippines, and I'm a Certified Blockchain Developer and Certified Solidity Developer. Cum laude, BS Computer Engineering, Adamson University.\n\nThe stack below is what I've carried longest, not a fence around what I'll work with. I now build almost entirely AI-assisted — Claude Code as the main toolchain, with Kimi and GLM through Ollama Cloud as fallbacks — and the honest effect is that picking up an unfamiliar language or framework costs a fraction of what it used to. So if your project runs on something that isn't on this list, that's genuinely fine. Tell me what the problem is.";

export const social: Record<"github" | "linkedin" | "email", string> = {
  github: "https://github.com/kimerran",
  linkedin: "https://www.linkedin.com/in/markhughneri/",
  email: "mailto:mh.neri@gmail.com",
};

/**
 * The stack section on the home page.
 *
 * Drawn from the resume's Core Competencies and weighted toward depth rather
 * than recency: these are the technologies with the longest run behind them
 * across fourteen years, not the newest thing on the most recent project.
 *
 * That is a deliberate difference from what was here before, which listed
 * whatever the fourteen project files happened to use. A project stack says
 * "this was built with X". This section says "I have carried X for years", and
 * those are different claims — the second is the one a reader of a portfolio is
 * actually asking about.
 */
export const stackGroups: StackGroup[] = [
  {
    name: "Backend & languages",
    items: [
      "TypeScript",
      "Node.js",
      "Golang",
      "C# / .NET",
      "Express",
      "NestJS",
    ],
  },
  {
    name: "Frontend",
    items: ["React", "Next.js", "Astro", "Tailwind CSS"],
  },
  {
    name: "Blockchain",
    items: [
      "Solidity",
      "EVM",
      "Stellar",
      "Hardhat",
      "Foundry",
      "viem",
      "OpenZeppelin",
    ],
  },
  {
    name: "Data",
    items: ["PostgreSQL", "MySQL", "MongoDB", "Prisma", "Redis"],
  },
  {
    name: "Cloud & DevOps",
    items: [
      "AWS",
      "GCP",
      "Azure",
      "Docker",
      "Kubernetes",
      "Terraform",
      "GitHub Actions",
    ],
  },
  {
    name: "AI & AI-assisted engineering",
    items: [
      "Claude Code",
      "Claude API",
      "OpenAI API",
      "OpenCode",
      "Ollama Cloud (Kimi, GLM)",
      "LangChain.js",
      "pgvector",
    ],
  },
];
