import { getProjectOptions } from "@/lib/services/read";
import { primaryBrandName } from "@/lib/utils";

export async function ProjectSwitcher() {
  const { projects, selectedProjectId } = await getProjectOptions();
  if (projects.length <= 1) {
    const project = projects[0];
    return project ? <div className="brand-context">{primaryBrandName(project.brandProfile)}</div> : null;
  }

  return (
    <form action="/api/projects/switch" method="post" className="project-switcher">
      <select name="projectId" defaultValue={selectedProjectId || ""} aria-label="切换品牌">
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {primaryBrandName(project.brandProfile)}
          </option>
        ))}
      </select>
      <button className="secondary" type="submit">切换</button>
    </form>
  );
}
