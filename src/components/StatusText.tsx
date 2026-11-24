import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Coffee,
  MinusCircle,
  Stethoscope,
  XCircle,
} from 'lucide-react';
import type {
  AdministrativeStatus,
  AppointmentRequestStatus,
  AppointmentStatus,
  DoctorDutyStatus,
  DoctorVerificationStatus,
  FollowUpPriority,
  FollowUpStatus,
} from '../shared/types';

export function AppointmentStatusText({ status }: { status: AppointmentStatus }) {
  switch (status) {
    case 'Confirmed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Confirmed
        </span>
      );
    case 'Scheduled':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Scheduled (Unconfirmed)
        </span>
      );
    case 'Completed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Completed
        </span>
      );
    case 'Missed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Missed
        </span>
      );
    case 'Cancelled':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Cancelled
        </span>
      );
  }
}

export function AdminStatusText({ status }: { status: AdministrativeStatus }) {
  switch (status) {
    case 'Active':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Active
        </span>
      );
    case 'Pending Verification':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Pending Verification
        </span>
      );
    case 'Inactive':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
          <MinusCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Inactive
        </span>
      );
  }
}

export function FollowUpStatusText({ status }: { status: FollowUpStatus | string }) {
  switch (status) {
    case 'Pending':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Pending
        </span>
      );
    case 'Scheduled':
    case 'In Progress':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 whitespace-nowrap">
          <CalendarClock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Scheduled
        </span>
      );
    case 'Due':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Due Today
        </span>
      );
    case 'Overdue':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Overdue
        </span>
      );
    case 'Completed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Completed
        </span>
      );
    case 'Cancelled':
    case 'Dismissed':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
          <MinusCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Cancelled
        </span>
      );
  }
}

export function PriorityText({ priority }: { priority: FollowUpPriority }) {
  if (priority === 'High') {
    return <span className="text-xs font-semibold text-red-700 whitespace-nowrap">High Priority</span>;
  }
  if (priority === 'Medium') {
    return <span className="text-xs font-medium text-amber-700 whitespace-nowrap">Medium</span>;
  }
  return <span className="text-xs font-medium text-slate-500 whitespace-nowrap">Low</span>;
}

export function StaffStatusText({ status }: { status: 'Active' | 'On Leave' | 'Inactive' }) {
  switch (status) {
    case 'Active':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Active
        </span>
      );
    case 'On Leave':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          On Leave
        </span>
      );
    case 'Inactive':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
          <MinusCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Inactive
        </span>
      );
  }
}

export function DoctorDutyStatusText({ status }: { status?: DoctorDutyStatus }) {
  const s = status ?? 'On Duty';
  switch (s) {
    case 'Available':
    case 'Checked In':
    case 'On Duty':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {s}
        </span>
      );
    case 'In Consultation':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 whitespace-nowrap">
          <Stethoscope className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          In Consultation
        </span>
      );
    case 'On Break':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <Coffee className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          On Break
        </span>
      );
    case 'On Leave':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          On Leave
        </span>
      );
    case 'Off Duty':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
          <MinusCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Off Duty
        </span>
      );
  }
}

export function VerificationStatusText({ status }: { status: DoctorVerificationStatus | 'Pending' }) {
  if (status === 'Approved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Approved
      </span>
    );
  }
  if (status === 'Rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      {status}
    </span>
  );
}

export function RequestStatusText({ status }: { status?: AppointmentRequestStatus }) {
  if (!status || status === 'None') return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 whitespace-nowrap">
      <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
      {status}
    </span>
  );
}
