import { requireOrgAdmin } from '../_shared/requireOrgAdmin.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    let body: {
      organizationId?: string
      originLat?: unknown
      originLng?: unknown
      destLat?: unknown
      destLng?: unknown
    }
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Signed-in owner, admin, or manager of this org. Customers and other
    // cleaners cannot spend the Maps key, and a valid session for a
    // different organization is rejected.
    const auth = await requireOrgAdmin(req, body.organizationId)
    if (auth instanceof Response) return auth

    if (body.originLat == null || body.originLng == null || body.destLat == null || body.destLng == null) {
      return new Response(JSON.stringify({ error: 'Missing coordinates' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const originLat = Number(body.originLat)
    const originLng = Number(body.originLng)
    const destLat = Number(body.destLat)
    const destLng = Number(body.destLng)
    if (![originLat, originLng, destLat, destLng].every(Number.isFinite)) {
      return new Response(JSON.stringify({ error: 'Missing coordinates' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Google API key not configured', fallback: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Use Google Maps Distance Matrix API
    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json')
    url.searchParams.set('origins', `${originLat},${originLng}`)
    url.searchParams.set('destinations', `${destLat},${destLng}`)
    url.searchParams.set('mode', 'driving')
    url.searchParams.set('departure_time', 'now')
    url.searchParams.set('key', apiKey)

    const res = await fetch(url.toString())
    const data = await res.json()

    if (data.status !== 'OK' || !data.rows?.[0]?.elements?.[0]) {
      console.error('Distance Matrix API error:', data)
      return new Response(JSON.stringify({ error: 'API error', fallback: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const element = data.rows[0].elements[0]
    if (element.status !== 'OK') {
      return new Response(JSON.stringify({ error: 'No route found', fallback: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Prefer duration_in_traffic if available
    const durationSeconds = element.duration_in_traffic?.value || element.duration?.value || 0
    const durationMinutes = Math.round(durationSeconds / 60)
    const distanceMeters = element.distance?.value || 0
    const distanceMiles = distanceMeters / 1609.34

    return new Response(JSON.stringify({
      durationMinutes,
      distanceMiles: Math.round(distanceMiles * 10) / 10,
      source: element.duration_in_traffic ? 'traffic' : 'estimate',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('get-driving-eta error:', err)
    return new Response(JSON.stringify({ error: 'Internal error', fallback: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
