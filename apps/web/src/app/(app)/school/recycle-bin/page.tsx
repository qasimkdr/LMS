'use client';

import { api } from '@/lib/api';
import { useData } from '@/components/useData';
import { useToast } from '@/components/toast';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Table, Td } from '@/components/ui';
import { dateTime, roleLabel } from '@/lib/format';

interface Bin {
  students: { id: string; fullName: string; admissionNo: string; deletedAt: string; class: { name: string } }[];
  staff: { id: string; fullName: string; role: string; deletedAt: string }[];
  restoreDays: number;
}

export default function RecycleBinPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useData<Bin>('/recycle-bin');
  async function restore(path: string) {
    try {
      await api.post(path);
      toast('Restored');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'error');
    }
  }
  const left = (d: string) => Math.max(0, (data?.restoreDays ?? 30) - Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
  return (
    <>
      <PageHeader title="Recycle bin" subtitle={`Deleted students and staff can be restored for ${data?.restoreDays ?? 30} days.`} />
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <div className="space-y-6">
          <Card title="Students">
            {data.students.length === 0 ? (
              <Empty title="Nothing here" />
            ) : (
              <Table head={['Name', 'Adm. no', 'Class', 'Deleted', 'Days left', '']}>
                {data.students.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.fullName}</Td>
                    <Td>{s.admissionNo}</Td>
                    <Td>{s.class.name}</Td>
                    <Td className="text-gray-600">{dateTime(s.deletedAt)}</Td>
                    <Td>{left(s.deletedAt)}</Td>
                    <Td className="text-right">
                      <Button variant="secondary" onClick={() => restore(`/students/${s.id}/restore`)}>
                        Restore
                      </Button>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          <Card title="Staff">
            {data.staff.length === 0 ? (
              <Empty title="Nothing here" />
            ) : (
              <Table head={['Name', 'Role', 'Deleted', 'Days left', '']}>
                {data.staff.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.fullName}</Td>
                    <Td>{roleLabel[s.role]}</Td>
                    <Td className="text-gray-600">{dateTime(s.deletedAt)}</Td>
                    <Td>{left(s.deletedAt)}</Td>
                    <Td className="text-right">
                      <Button variant="secondary" onClick={() => restore(`/staff/${s.id}/restore`)}>
                        Restore
                      </Button>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
