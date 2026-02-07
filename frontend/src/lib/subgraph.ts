import { SUBGRAPH_URL } from "../config";

export type HomeProject = {
  address: `0x${string}`;
  name: string;
  totalRaised: bigint;
  minimumRaise: bigint;
  deadline: bigint;
  companyNames: string[];
  companyWeights: number[];
  stage: number;
};

export async function subgraphQuery<T = any>(query: string): Promise<T> {
  const response = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const { data, errors } = await response.json();
  if (errors) {
    throw new Error(JSON.stringify(errors));
  }
  return data;
}

export async function getProjectsList() {
  const query = `
    {
        projects(first: 100, orderBy: createdAt, orderDirection: desc) {
            id
            vault
        }
    }
    `;
  const data = await subgraphQuery(query);
  return data.projects.map((p: any) => p.vault);
}

export async function getHomeProjects(): Promise<HomeProject[]> {
  const query = `
    {
      projects(first: 100, orderBy: createdAt, orderDirection: desc) {
        id
        name
        totalRaised
        minimumRaise
        deadline
        companyNames
        companyWeights
        stage
      }
    }
  `;

  const data = await subgraphQuery<{
    projects: Array<{
      id: string;
      name: string;
      totalRaised: string;
      minimumRaise: string;
      deadline: string;
      companyNames: string[];
      companyWeights: string[];
      stage: number;
    }>;
  }>(query);

  return data.projects.map((project) => ({
    address: project.id as `0x${string}`,
    name: project.name,
    totalRaised: BigInt(project.totalRaised),
    minimumRaise: BigInt(project.minimumRaise),
    deadline: BigInt(project.deadline),
    companyNames: project.companyNames,
    companyWeights: project.companyWeights.map((weight) => Number(weight)),
    stage: Number(project.stage),
  }));
}

export async function getProjectSupporterCount(vaultAddress: string) {
  const query = `
    {
        holders(where: { project: "${vaultAddress.toLowerCase()}", balance_gt: "0" }) {
            id
        }
    }
    `;
  const data = await subgraphQuery(query);
  return data.holders.length;
}
