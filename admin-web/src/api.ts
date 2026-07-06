export type AdminUser = {
  id: number;
  uid: string;
  email: string;
  role: "user" | "admin" | "super_admin";
  plan: "free" | "paid" | "monthly" | "yearly";
  subscriptionExpiresAt: string | null;
  subscriptionStatus: "free" | "active" | "expired";
  hasPaidAccess: boolean;
  isActive: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
};

export type UserEvent = {
  id: number;
  action: string;
  actor: { id: number | null; email: string | null; role: string | null };
  target: { id: number | null; email: string | null };
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
};

export type AdminMetrics = {
  users: { total: number; active: number; monthlyPaid: number; yearlyPaid: number };
  active: { d3: number; d7: number; d30: number };
  navClicks: Array<{ page: string; clicks: number; users: number }>;
  retention: Array<{ cohortDay: string; registered: number; retained3d: number; retained7d: number; retained30d: number }>;
};

export type OpinionStatus = "published" | "draft";

export type MarketOpinion = {
  id: string;
  section: string;
  sectionLabel: string;
  title: string;
  tradeDate: string;
  status: OpinionStatus;
  featured?: boolean;
  summary: string;
  symbols: string[];
  topics: string[];
  highlights: string[];
  body: string;
};

export type UploadedImage = {
  url: string;
  mime: string;
  name: string;
};

export type UploadedVideo = {
  key: string;
  url: string;
  name: string;
};

export type CourseLesson = {
  id: number;
  seriesId: number;
  title: string;
  sortOrder: number;
  durationLabel: string;
  videoKey?: string;
  status: "published" | "draft";
  createdAt: string;
  updatedAt: string;
};

export type CourseSeries = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  coverUrl: string;
  sortOrder: number;
  status: "published" | "draft";
  lessonCount: number;
  grantCount: number;
  lessons: CourseLesson[];
  createdAt: string;
  updatedAt: string;
};

export type CourseGrant = {
  id: number;
  seriesId: number;
  user: { id: number; uid: string; email: string; plan: string };
  createdAt: string;
};

export type AuthStatus = {
  authenticated: boolean;
  user: null | { id: number; email: string; role: string; isSuperAdmin: boolean };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload as T;
}

export const api = {
  authStatus: () => request<AuthStatus>("/api/auth/status"),
	  login: (email: string, password: string) =>
	    request<AuthStatus>("/api/auth/login", {
	      method: "POST",
	      body: JSON.stringify({ email, password, adminOnly: true })
	    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  users: () =>
    request<{
      users: AdminUser[];
      summary: { total: number; active: number; paid: number; admin: number };
    }>("/api/admin/users"),
  metrics: () => request<AdminMetrics>("/api/admin/metrics"),
  events: (limit = 100, userId?: number) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (userId) params.set("userId", String(userId));
    return request<{ rows: UserEvent[] }>(`/api/admin/user-events?${params.toString()}`);
  },
  updateUserPlan: (payload: {
    userId: number;
    role: AdminUser["role"];
    plan: AdminUser["plan"];
    subscriptionExpiresAt: string | null;
    isActive: boolean;
  }) =>
    request<{ ok: true; user: AdminUser }>("/api/admin/users/update-plan", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  opinions: (options?: {
    section?: string;
    status?: OpinionStatus | "all";
    dateFrom?: string;
    dateTo?: string;
    q?: string;
    sort?: "latest" | "draftFirst" | "publishedFirst";
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams({ limit: String(options?.limit || 50), offset: String(options?.offset || 0) });
    const section = options?.section || "";
    if (section) params.set("section", section);
    if (options?.status && options.status !== "all") params.set("status", options.status);
    if (options?.dateFrom) params.set("dateFrom", options.dateFrom);
    if (options?.dateTo) params.set("dateTo", options.dateTo);
    if (options?.q) params.set("q", options.q);
    if (options?.sort) params.set("sort", options.sort);
    return request<{ rows: MarketOpinion[]; total: number; limit: number; offset: number }>(`/api/admin/opinions?${params.toString()}`);
  },
  saveOpinion: (payload: Partial<MarketOpinion>) =>
    request<{ ok: true; item: MarketOpinion }>("/api/admin/opinions", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  deleteOpinion: (id: string) =>
    request<{ ok: true }>(`/api/admin/opinions/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),
  uploadImage: (payload: { name: string; type: string; data: string; scope?: "opinions" | "courses" }) =>
    request<{ ok: true; image: UploadedImage }>("/api/admin/uploads", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  uploadCourseVideo: async (file: File, onProgress?: (percent: number) => void) => {
    const ticket = await request<{ ok: true; video: UploadedVideo & { uploadUrl: string } }>("/api/admin/courses/video-upload-url", {
      method: "POST",
      body: JSON.stringify({ name: file.name || "lesson-video.mp4", type: file.type || "application/octet-stream", size: file.size })
    });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", ticket.video.uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          resolve();
        } else {
          reject(new Error(`COS 上传失败：${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("COS 上传失败"));
      xhr.send(file);
    });
    return { ok: true, video: ticket.video };
  },
  courses: () => request<{ series: CourseSeries[]; grants: CourseGrant[] }>("/api/admin/courses"),
  saveCourseSeries: (payload: { id?: number; title: string; summary: string; coverUrl: string; sortOrder?: number; status: CourseSeries["status"] }) =>
    request<{ ok: true; series: CourseSeries }>("/api/admin/courses", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  saveCourseLesson: (payload: { id?: number; seriesId: number; title: string; sortOrder?: number; durationLabel?: string; videoKey: string; status: CourseLesson["status"] }) =>
    request<{ ok: true; lesson: CourseLesson }>("/api/admin/courses/lessons", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  deleteCourseSeries: (id: number) =>
    request<{ ok: true }>(`/api/admin/courses/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),
  deleteCourseLesson: (id: number) =>
    request<{ ok: true }>(`/api/admin/courses/lessons/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),
  grantCourse: (payload: { seriesId: number; user: string }) =>
    request<{ ok: true; grant: CourseGrant }>("/api/admin/courses/grants", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  revokeCourseGrant: (id: number) =>
    request<{ ok: true }>(`/api/admin/courses/grants/${encodeURIComponent(id)}`, {
      method: "DELETE"
    })
};
