import type { Context } from 'hono';
import type { Bindings } from '../../bindings';
import { decodePostSlug } from '../../utils/decodePostSlug';

export const getPagePv = async (c: Context<{ Bindings: Bindings }>) => {
	try {
		const rawPostSlug = c.req.query('post_slug') || '';
		const postSlug = decodePostSlug(rawPostSlug);
		const rawSiteId = c.req.query('siteId') || '';
		const siteId = rawSiteId && rawSiteId !== 'default' ? rawSiteId : '';

		if (!postSlug) {
			return c.json({ message: 'post_slug is required' }, 400);
		}

		let row: { pv: number } | null = null;

		if (siteId) {
			// 有 siteId 时精确匹配
			row = await c.env.CWD_DB.prepare(
				'SELECT pv FROM page_stats WHERE post_slug = ? AND site_id = ?'
			)
				.bind(postSlug, siteId)
				.first<{ pv: number }>();
		} else {
			// 无 siteId 时，匹配空字符串或 NULL
			row = await c.env.CWD_DB.prepare(
				'SELECT pv FROM page_stats WHERE post_slug = ? AND (site_id = ? OR site_id IS NULL)'
			)
				.bind(postSlug, '')
				.first<{ pv: number }>();
		}

		const pv = row?.pv || 0;

		return c.json({ pv, postSlug });
	} catch (e: any) {
		return c.json({ message: e.message || '获取访问量失败' }, 500);
	}
};