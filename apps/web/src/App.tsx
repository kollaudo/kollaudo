import { Layout } from "./components/Layout.tsx";
import { Message } from "./components/Message.tsx";
import { Link, useLocation } from "./lib/router.tsx";
import { HealthPage } from "./pages/HealthPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { TestRunPage } from "./pages/TestRunPage.tsx";
import { VerdictPage } from "./pages/VerdictPage.tsx";

export function App() {
  return (
    <Layout>
      <Page />
    </Layout>
  );
}

function Page() {
  const { path, query } = useLocation();

  if (path === "/") return <HealthPage />;
  if (path === "/projects") return <ProjectsPage />;
  if (path === "/verdict") return <VerdictPage query={query} />;
  const run = path.match(/^\/test-runs\/([^/]+)$/);
  if (run?.[1]) return <TestRunPage id={run[1]} />;

  return (
    <Message title="Page not found">
      <Link href="/" className="text-brand hover:underline">
        Back to the health matrix
      </Link>
    </Message>
  );
}
