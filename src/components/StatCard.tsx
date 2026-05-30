interface StatCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'red' | 'yellow' | 'purple';
  alert?: boolean;
}

const colorMap = {
  blue: 'bg-blue-50 border-blue-200 text-blue-800',
  green: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  red: 'bg-red-50 border-red-200 text-red-800',
  yellow: 'bg-amber-50 border-amber-200 text-amber-800',
  purple: 'bg-purple-50 border-purple-200 text-purple-800',
};

const iconColorMap = {
  blue: 'bg-blue-100 text-blue-600',
  green: 'bg-emerald-100 text-emerald-600',
  red: 'bg-red-100 text-red-600',
  yellow: 'bg-amber-100 text-amber-600',
  purple: 'bg-purple-100 text-purple-600',
};

export default function StatCard({ title, value, subtitle, icon, color, alert }: StatCardProps) {
  return (
    <div className={`relative rounded-xl border p-5 ${colorMap[color]} ${alert ? 'ring-2 ring-red-400 ring-offset-2' : ''} transition-shadow hover:shadow-md`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium opacity-70 mb-1">{title}</p>
          <p className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString('ar-EG') : value}</p>
          {subtitle && <p className="text-xs mt-1 opacity-60">{subtitle}</p>}
        </div>
        <div className={`p-2.5 rounded-xl ${iconColorMap[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
