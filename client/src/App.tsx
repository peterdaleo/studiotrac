import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { StaffPreviewProvider } from "./contexts/StaffPreviewContext";
import DashboardLayout from "./components/DashboardLayout";
import Home from "./pages/Home";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Tasks from "./pages/Tasks";
import Team from "./pages/Team";
import CalendarView from "./pages/CalendarView";
import Notifications from "./pages/Notifications";
import Timeline from "./pages/Timeline";
import Settings from "./pages/Settings";
import Financials from "./pages/Financials";
import Reports from "./pages/Reports";
import TimeTracking from "./pages/TimeTracking";
import ClientPortal from "./pages/ClientPortal";

function DashboardRouter() {
  return (
    <StaffPreviewProvider>
      <DashboardLayout>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/projects" component={Projects} />
          <Route path="/projects/:id" component={ProjectDetail} />
          <Route path="/tasks" component={Tasks} />
          <Route path="/team" component={Team} />
          <Route path="/team/:id" component={Team} />
          <Route path="/calendar" component={CalendarView} />
          <Route path="/timeline" component={Timeline} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/financials" component={Financials} />
          <Route path="/reports" component={Reports} />
          <Route path="/time" component={TimeTracking} />
          <Route path="/settings" component={Settings} />
          <Route path="/404" component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </DashboardLayout>
    </StaffPreviewProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Switch>
            {/* Public client portal — no auth, no dashboard layout */}
            <Route path="/portal/:token" component={ClientPortal} />
            {/* All other routes go through the dashboard */}
            <Route component={DashboardRouter} />
          </Switch>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
