"use client";

import { Guard, Shell } from "@/components/admin/shell";

export default function AdminDashLayout({ children }: { children: React.ReactNode }) {
  return (
    <Guard>
      <Shell>{children}</Shell>
    </Guard>
  );
}
