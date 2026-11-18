import { PageHeader } from '../components/ui/Ui';
import PublicationTable from '../components/PublicationTable';
import { useAuth } from '../context/AuthContext';

export default function Publications() {
  const { canViewAll } = useAuth();
  return (
    <div>
      <PageHeader title="Publications" description={canViewAll ? 'Every unique publication across all faculty. A paper shared by several faculty appears once.' : 'Your publications.'} />
      <PublicationTable basePath="/publications" showFaculty={canViewAll} title="All publications" />
    </div>
  );
}
