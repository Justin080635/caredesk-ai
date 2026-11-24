import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MinusCircle,
  XCircle,
} from 'lucide-react';
import type {
  AdministrativeStatus,
  AppointmentStatus,
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

export function FollowUpStatusText({ status }: { status: FollowUpStatus }) {
  switch (status) {
    case 'Pending':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Pending
        </span>
      );
    case 'In Progress':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          In Progress
        </span>
      );
    case 'Completed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Completed
        </span>
      );
    case 'Dismissed':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
          <MinusCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Dismissed
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
