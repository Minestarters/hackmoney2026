import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pie, PieChart, Cell, ResponsiveContainer } from "recharts";
import { STAGE_LABELS } from "../config";
import { formatUsdc } from "../lib/format";
import { getHomeProjects, type HomeProject } from "../lib/subgraph";

const colors = ["#5EBD3E", "#6ECFF6", "#836953", "#9E9E9E", "#E3A008"];

const HomePage = () => {
  const [projects, setProjects] = useState<HomeProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const homeProjects = await getHomeProjects();
        setProjects(homeProjects);
      } catch (e) {
        console.error(e);
        setError("Failed to load projects");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return (
    <div className="space-y-6">

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card-frame rounded-lg border-4 border-dirt/70 bg-night/70 p-4">
          <p className="mb-2 text-[15px] font-semibold uppercase tracking-wide text-stone-300 underline">
            Pick a basket
          </p>
          <p className="text-[11px] font-light text-stone-400">
            Each project is a basket of junior companies with fixed weights. You get diversified
            exposure to the underlying exploration pipeline in one ticket.
          </p>
        </div>
        <div className="card-frame rounded-lg border-4 border-sky/40 bg-night/70 p-4">
          <p className="mb-2 text-[15px] font-semibold uppercase tracking-wide text-stone-300 underline">
            SPV Formation
          </p>
          <p className="text-[11px] font-light text-stone-400">
            If the minimum USDC target is met by the deadline, an SPV for that basket is
            established and your tokens lock in economic rights to its cashflows.
          </p>
        </div>
        <div className="card-frame rounded-lg border-4 border-grass/60 bg-night/70 p-4">
          <p className="mb-2 text-[15px] font-semibold uppercase tracking-wide text-stone-300 underline">
            Profit Distributions
          </p>
          <p className="text-[11px] font-light text-stone-400">
            When the SPV receives value (royalties, revenue share or exits), distributions are
            processed and paid back through the vault to token holders.
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {loading && <p className="text-xs text-stone-300">Loading projects...</p>}

      <div className="grid gap-6 md:grid-cols-2">
        {projects.map((project) => (
          <div key={project.address} className="card-frame rounded-lg p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base text-sky-200">{project.name}</h2>
              </div>
              <span
                className={`rounded px-3 py-1 text-[10px] uppercase ${
                  project.stage === 2 ? "bg-red-500/20 text-red-300" : "bg-grass/30 text-grass"
                }`}
              >
                {STAGE_LABELS[project.stage]}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 text-[11px]">
              <div>
                <p className="text-stone-400">Raised / Target</p>
                <p className="text-sky-100">
                  {formatUsdc(project.totalRaised)} / {formatUsdc(project.minimumRaise)}
                </p>
              </div>
              <div>
                <p className="text-stone-400">Deadline</p>
                <p className="text-sky-100">
                  {new Date(Number(project.deadline) * 1000).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-4">
              <div className="h-32 w-32">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={project.companyNames.map((name, idx) => ({
                        name,
                        value: project.companyWeights[idx],
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={30}
                      outerRadius={50}
                    >
                      {project.companyNames.map((_, idx) => (
                        <Cell key={idx} fill={colors[idx % colors.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1 text-[10px]">
                {project.companyNames.map((name, idx) => (
                  <div
                    key={name + idx}
                    className="flex items-center justify-between rounded bg-stone-800/60 px-2 py-1"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-sm"
                        style={{ backgroundColor: colors[idx % colors.length] }}
                      />
                      <p className="text-stone-200">{name}</p>
                    </div>
                    <p className="text-stone-400">{project.companyWeights[idx]}%</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between">
              <Link
                to={`/project/${project.address}`}
                className="button-blocky rounded px-3 py-2 text-[10px] uppercase"
              >
                View Project
              </Link>
            </div>
          </div>
        ))}
      </div>

      {projects.length === 0 && !loading && !error && (
        <p className="text-xs text-stone-300">No projects yet. Create one to start.</p>
      )}
    </div>
  );
};

export default HomePage;
