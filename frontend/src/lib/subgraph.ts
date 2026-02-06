import { SUBGRAPH_URL } from "../config";

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
