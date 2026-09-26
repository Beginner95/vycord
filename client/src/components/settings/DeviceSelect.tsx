import { ChevronDown } from 'lucide-react';
import { useMediaDeviceStore, type DeviceKind } from '@/stores/mediaDeviceStore';
import { useT } from '@/i18n';

interface DeviceSelectProps {
  kind: DeviceKind;
  label: string;
  defaultLabel: string;
}

export function DeviceSelect({ kind, label, defaultLabel }: DeviceSelectProps) {
  const t = useT();
  const devices = useMediaDeviceStore((s) => s.devices[kind]);
  const selected = useMediaDeviceStore((s) => s.selected[kind]);
  const setSelected = useMediaDeviceStore((s) => s.setSelected);
  return (
    <span className="select-wrap">
      <select
        className="select-control"
        aria-label={label}
        value={selected}
        onChange={(e) => setSelected(kind, e.target.value)}
      >
        <option value="">{defaultLabel}</option>
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || t('settings.unnamedDevice')}
          </option>
        ))}
      </select>
      <span className="select-chevron">
        <ChevronDown size={14} strokeWidth={1.8} />
      </span>
    </span>
  );
}