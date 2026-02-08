import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import CreateProjectPage from "./pages/CreateProjectPage";
import ProjectPage from "./pages/ProjectPage";
import CalculatorPage from "./pages/CalculatorPage";
import { CompanyDetailsPage } from "./pages/CompanyDetailsPage";
import { useDefaultChainTracker } from "./hooks/useDefaultChainTracker";

const App = () => {
  useDefaultChainTracker();

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/create" element={<CreateProjectPage />} />
        <Route path="/project/:address" element={<ProjectPage />} />
        <Route
          path="/company/:address/:companyIndex"
          element={<CompanyDetailsPage />}
        />
        <Route path="/calculator" element={<CalculatorPage />} />
      </Routes>
    </Layout>
  );
};

export default App;
