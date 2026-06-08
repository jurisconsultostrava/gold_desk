import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Inbox from "@/pages/Inbox";
import ThreadDetail from "@/pages/ThreadDetail";
import AttachmentViewer from "@/pages/AttachmentViewer";
import Accounts from "@/pages/Accounts";
import Datovka from "@/pages/Datovka";
import Communicator from "@/pages/Communicator";
import { Layout } from "@/components/Layout";
import { AuthGate } from "@/components/AuthGate";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Inbox} />
      <Route path="/thread/:id" component={ThreadDetail} />
      <Route path="/attachment/:id" component={AttachmentViewer} />
      <Route path="/accounts" component={Accounts} />
      <Route path="/datovka" component={Datovka} />
      <Route path="/communicator" component={Communicator} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <AuthGate>
          <Router hook={useHashLocation}>
            <Layout>
              <AppRouter />
            </Layout>
          </Router>
        </AuthGate>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
