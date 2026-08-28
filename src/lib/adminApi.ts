export async function adminApi(url: string, options: RequestInit = {}): Promise<any> {
  const token = localStorage.getItem('selin_admin_token');
  const headers = {
    ...options.headers,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  } as Record<string, string>;

  try {
    const response = await fetch(url, { ...options, headers });

    if (response.status === 401) {
      localStorage.removeItem('selin_admin_token');
      window.dispatchEvent(new CustomEvent('selin_admin_unauthorized'));
      return {
        ok: false,
        status: 401,
        needLogin: true,
        json: async () => ({ error: 'Unauthorized', needLogin: true }),
        text: async () => 'Unauthorized'
      };
    }

    return response;
  } catch (err) {
    throw err;
  }
}
