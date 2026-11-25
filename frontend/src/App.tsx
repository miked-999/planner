import { CascadePreviewModal } from './components/dialogs/CascadePreviewModal';
import { EntityDrawer } from './components/dialogs/EntityDrawer';
import { PortabilityModal } from './components/dialogs/PortabilityModal';
import { TeamDrawerModal } from './components/dialogs/TeamDrawerModal';
import { AppShell } from './components/layout/AppShell';
import { PlanProvider, usePlan } from './store/PlanContext';
import { CapacityView } from './views/CapacityView';
import { DashboardView } from './views/DashboardView';
import { PeopleTimelineView } from './views/PeopleTimelineView';
import { ProjectTableView } from './views/ProjectTableView';
import { ProjectTimelineView } from './views/ProjectTimelineView';

function WorkspaceContent() {
  const { activeView } = usePlan();

  return (
    <AppShell>
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {activeView === 'dashboard' && <DashboardView />}
          {activeView === 'timeline' && <ProjectTimelineView />}
          {activeView === 'people' && <PeopleTimelineView />}
          {activeView === 'capacity' && <CapacityView />}
          {activeView === 'table' && <ProjectTableView />}
        </div>
        <EntityDrawer />
      </div>

      <CascadePreviewModal />
      <TeamDrawerModal />
      <PortabilityModal />
    </AppShell>
  );
}

export default function App() {
  return (
    <PlanProvider>
      <WorkspaceContent />
    </PlanProvider>
  );
}
